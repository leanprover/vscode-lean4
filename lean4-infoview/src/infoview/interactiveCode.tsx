import * as React from 'react'

import { EditorContext } from './contexts'
import { useAsync, mapRpcError, useEvent } from './util'
import { SubexprInfo, CodeWithInfos, InteractiveDiagnostics_infoToInteractive, getGoToLocation, TaggedText, DiffTag, TaggedText_stripTags } from '@leanprover/infoview-api'
import { HoverState, WithToggleableTooltip, WithTooltipOnHover } from './tooltips'
import { Location } from 'vscode-languageserver-protocol'
import { marked } from 'marked'
import { RpcContext } from './rpcSessions'
import { GoalsLocation, LocationsContext, SelectableLocation } from './goalLocation'

export interface InteractiveTextComponentProps<T> {
  fmt: TaggedText<T>
}

export interface InteractiveTagProps<T> extends InteractiveTextComponentProps<T> {
  tag: T
}

export interface InteractiveTaggedTextProps<T> extends InteractiveTextComponentProps<T> {
  InnerTagUi: (_: InteractiveTagProps<T>) => JSX.Element
}

/**
 * Core loop to display {@link TaggedText} objects. Invokes `InnerTagUi` on `tag` nodes in order to support
 * various embedded information, for example subexpression information stored in {@link CodeWithInfos}.
 * */
export function InteractiveTaggedText<T>({fmt, InnerTagUi}: InteractiveTaggedTextProps<T>) {
  if ('text' in fmt) return <>{fmt.text}</>
  else if ('append' in fmt) return <>
    {fmt.append.map((a, i) => <InteractiveTaggedText key={i} fmt={a} InnerTagUi={InnerTagUi} />)}
  </>
  else if ('tag' in fmt) return <InnerTagUi fmt={fmt.tag[1]} tag={fmt.tag[0]} />
  else throw new Error(`malformed 'TaggedText': '${fmt}'`)
}

interface TypePopupContentsProps {
  info: SubexprInfo
}

function Markdown({contents}: {contents: string}): JSX.Element {
  const renderer = new marked.Renderer();
  renderer.code = (code, lang) => {
    // todo: render Lean code blocks using the lean syntax.json
    return `<div class="font-code pre-wrap">${code}</div>`;
	}
  renderer.codespan = (code) => {
    return `<code class="font-code">${code}</code>`;
  }

  const markedOptions: marked.MarkedOptions = {}
  markedOptions.sanitizer = (html: string): string => {
    return '';
  };
  markedOptions.sanitize = true;
  markedOptions.silent = true;
  markedOptions.renderer = renderer;

  // todo: vscode also has lots of post render sanitization and hooking up of href clicks and so on.
  // see https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/markdownRenderer.ts

  const renderedMarkdown = marked.parse(contents, markedOptions);
  return <div dangerouslySetInnerHTML={{ __html: renderedMarkdown }} />
  // handy for debugging:
  // return <div>{ renderedMarkdown } </div>
}

/** Shows `explicitValue : itsType` and a docstring if there is one. */
function TypePopupContents({ info }: TypePopupContentsProps) {
  const rs = React.useContext(RpcContext)
  // When `err` is defined we show the error,
  // otherwise if `ip` is defined we show its contents,
  // otherwise a 'loading' message.
  const interactive = useAsync(
    () => InteractiveDiagnostics_infoToInteractive(rs, info.info),
    [rs, info.info])

  // Even when subexpressions are selectable in our parent component, it doesn't make sense
  // to select things inside the *type* of the parent, so we clear the context.
  // NOTE: selecting in the explicit term does make sense but it complicates the implementation
  // so let's not add it until someone really wants it.
  return <LocationsContext.Provider value={undefined}>
    <div className="tooltip-code-content">
      {interactive.state === 'resolved' ? <>
        <div className="font-code tl pre-wrap">
        {interactive.value.exprExplicit && <InteractiveCode fmt={interactive.value.exprExplicit} />} : {
          interactive.value.type && <InteractiveCode fmt={interactive.value.type} />}
        </div>
        {interactive.value.doc && <><hr /><Markdown contents={interactive.value.doc}/></>}
        {info.diffStatus && <><hr/><div>{DIFF_TAG_TO_EXPLANATION[info.diffStatus]}</div></>}
      </> :
      interactive.state === 'rejected' ? <>Error: {mapRpcError(interactive.error).message}</> :
      <>Loading..</>}
    </div>
  </LocationsContext.Provider>
}

const DIFF_TAG_TO_CLASS : {[K in DiffTag] : string} = {
  'wasChanged': 'inserted-text',
  'willChange': 'removed-text',
  'wasInserted': 'inserted-text',
  'willInsert': 'inserted-text',
  'willDelete': 'removed-text',
  'wasDeleted': 'removed-text',
}

const DIFF_TAG_TO_EXPLANATION : {[K in DiffTag] : string} = {
  'wasChanged': 'This subexpression has been modified.',
  'willChange': 'This subexpression will be modified.',
  'wasInserted': 'This subexpression has been inserted.',
  'willInsert': 'This subexpression will be inserted.',
  'wasDeleted': 'This subexpression has been removed.',
  'willDelete': 'This subexpression will be deleted.',
}

/**
 * Tagged spans can be hovered over to display extra info stored in the associated `SubexprInfo`.
 * Moreover if this component is rendered in a context where locations can be selected, the span
 * can be shift-clicked to select it.
 */
function InteractiveCodeTag({tag: ct, fmt}: InteractiveTagProps<SubexprInfo>) {
  const rs = React.useContext(RpcContext)
  const ec = React.useContext(EditorContext)
  const [hoverState, setHoverState] = React.useState<HoverState>('off')
  const [goToDefErrorState, setGoToDefErrorState] = React.useState<boolean>(false)

  // We mimick the VSCode ctrl-hover and ctrl-click UI for go-to-definition
  const [goToLoc, setGoToLoc] = React.useState<Location | undefined>(undefined)
  const fetchGoToLoc = React.useCallback(async () => {
    if (goToLoc !== undefined) return goToLoc
    try {
      const lnks = await getGoToLocation(rs, 'definition', ct.info)
      if (lnks.length > 0) {
        const loc = { uri: lnks[0].targetUri, range: lnks[0].targetSelectionRange }
        setGoToLoc(loc)
        return loc
      }
    } catch(e) {
      console.error('Error in go-to-definition: ', JSON.stringify(e))
    }
    return undefined
  }, [rs, ct.info, goToLoc])
  // Eagerly fetch the location as soon as the pointer enters this area so that we can show
  // an underline if a jump target is available.
  React.useEffect(() => { if (hoverState === 'ctrlOver') void fetchGoToLoc() }, [hoverState, fetchGoToLoc])

  const execGoToLoc = React.useCallback(async (withError: boolean) => {
      const loc = await fetchGoToLoc()
      if (loc === undefined) {
        if (withError) {
          setGoToDefErrorState(true)
        }
        return
      }
      await ec.revealPosition({ uri: loc.uri, ...loc.range.start })
    }, [fetchGoToLoc, ec])

  const locs = React.useContext(LocationsContext)
  const ourLoc = locs && locs.subexprTemplate && ct.subexprPos ?
    GoalsLocation.withSubexprPos(locs.subexprTemplate, ct.subexprPos) :
    undefined

  let spanClassName: string = hoverState === 'ctrlOver' && goToLoc !== undefined ? 'underline ' : ''
  if (ct.diffStatus) {
    spanClassName += DIFF_TAG_TO_CLASS[ct.diffStatus] + ' '
  }

  // ID that we can use to identify the component that a context menu was opened in.
  // When selecting a custom context menu entry, VS Code will execute a VS Code command
  // parameterized with `data-vscode-context`. We then use this context to execute the
  // command in the context of the correct interactive code tag in the InfoView.
  const interactiveCodeTagId = React.useId()
  const vscodeContext = { interactiveCodeTagId }
  useEvent(ec.events.goToDefinition, async _ => void execGoToLoc(true), [execGoToLoc], interactiveCodeTagId)

  return (
    <WithToggleableTooltip
      tooltipChildren={`No definition found for '${TaggedText_stripTags(fmt)}'`}
      isTooltipShown={goToDefErrorState}
      hideTooltip={() => setGoToDefErrorState(false)}
    >
      <WithTooltipOnHover
        data-vscode-context={JSON.stringify(vscodeContext)}
        tooltipChildren={<TypePopupContents info={ct} />}
        onClick={(e, next) => {
          // On ctrl-click or ⌘-click, if location is known, go to it in the editor
          if (e.ctrlKey || e.metaKey) {
            setHoverState(st => st === 'over' ? 'ctrlOver' : st)
            void execGoToLoc(false)
          } else if (!e.shiftKey) next(e)
        }}
        onContextMenu={e => {
          // Mark the event as seen so that parent handlers skip it.
          // We cannot use `stopPropagation` as that prevents the VSC context menu from showing up.
          if ('_InteractiveCodeTagSeen' in e) return
          (e as any)._InteractiveCodeTagSeen = {}
          if (!(e.target instanceof Node)) return
          if (!e.currentTarget.contains(e.target)) return
          // Select the pretty-printed code.
          const sel = window.getSelection()
          if (!sel) return
          sel.removeAllRanges()
          sel.selectAllChildren(e.currentTarget)
        }}
      >
        <SelectableLocation
          setHoverState={setHoverState}
          className={spanClassName}
          locs={locs}
          loc={ourLoc}
          alwaysHighlight={true}
        >
          <InteractiveCode fmt={fmt} />
        </SelectableLocation>
      </WithTooltipOnHover>
    </WithToggleableTooltip>
  )
}

export type InteractiveCodeProps = InteractiveTextComponentProps<SubexprInfo>

/** Displays a {@link CodeWithInfos} obtained via RPC from the Lean server. */
export function InteractiveCode(props: InteractiveCodeProps) {
  return <span className='font-code'>
    <InteractiveTaggedText {...props} InnerTagUi={InteractiveCodeTag} />
  </span>
}
