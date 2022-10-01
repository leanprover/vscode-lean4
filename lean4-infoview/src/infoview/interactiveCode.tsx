import * as React from 'react'

import { EditorContext } from './contexts'
import { DocumentPosition, useAsync, mapRpcError } from './util'
import { SubexprInfo, CodeWithInfos, InteractiveDiagnostics_infoToInteractive, getGoToLocation, TaggedText, DiffTag } from '@leanprover/infoview-api'
import { DetectHoverSpan, HoverState, WithTooltipOnHover } from './tooltips'
import { Location } from 'vscode-languageserver-protocol'
import { marked } from 'marked'
import { RpcContext } from './rpcSessions'

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
 * Core loop to display `TaggedText` objects. Invokes `InnerTagUi` on `tag` nodes in order to support
 * various embedded information such as `InfoTree`s and `Expr`s.
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
  redrawTooltip: () => void
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
function TypePopupContents({ info, redrawTooltip }: TypePopupContentsProps) {
  const rs = React.useContext(RpcContext)
  // When `err` is defined we show the error,
  // otherwise if `ip` is defined we show its contents,
  // otherwise a 'loading' message.
  const interactive = useAsync(
    () => InteractiveDiagnostics_infoToInteractive(rs, info.info),
    [rs, info.info, info.subexprPos])

  // We let the tooltip know to redo its layout whenever our contents change.
  React.useEffect(() => redrawTooltip(), [interactive.state, (interactive as any)?.value, (interactive as any)?.error, redrawTooltip])

  return <div className="tooltip-code-content">
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
}

const COLOR_VARS = {
  'bg-insert': '--vscode-diffEditor-insertedTextBackground',
  'bg-remove': '--vscode-diffEditor-removedTextBackground',
  'insert': '--vscode-gitDecoration-addedResourceForeground',
  'remove': '--vscode-gitDecoration-deletedResourceForeground',
}

const DIFF_TAG_TO_COLOR_VAR : {[K in DiffTag] : keyof (typeof COLOR_VARS)} = {
  'wasChanged': 'bg-insert',
  'willChange': 'bg-remove',
  'wasInserted': 'bg-insert',
  'willInsert': 'bg-insert',
  'willDelete': 'bg-remove',
  'wasDeleted': 'bg-remove',
}

const DIFF_TAG_TO_EXPLANATION : {[K in DiffTag] : string} = {
  'wasChanged': 'This subexpression has been modified.',
  'willChange': 'This subexpression will be modified.',
  'wasInserted': 'This subexpression has been inserted.',
  'willInsert': 'This subexpression will be inserted.',
  'wasDeleted': 'This subexpression has been removed.',
  'willDelete': 'This subexpression will be deleted.',
}

/** Tagged spans can be hovered over to display extra info stored in the associated `SubexprInfo`. */
function InteractiveCodeTag({tag: ct, fmt}: InteractiveTagProps<SubexprInfo>) {
  const mkTooltip = React.useCallback((redrawTooltip: () => void) =>
    <TypePopupContents info={ct} redrawTooltip={redrawTooltip} />,
    [ct.info])

  // We mimick the VSCode ctrl-hover and ctrl-click UI for go-to-definition
  const rs = React.useContext(RpcContext)
  const ec = React.useContext(EditorContext)
  const [hoverState, setHoverState] = React.useState<HoverState>('off')

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
  React.useEffect(() => { if (hoverState === 'ctrlOver') void fetchGoToLoc() }, [hoverState])

  const spanClassName : any = 'highlightable '
    + (hoverState !== 'off' ? 'highlight ' : '')
    + (hoverState === 'ctrlOver' && goToLoc !== undefined ? 'underline ' : '')
  const spanStyle : any = {}
  if (ct.diffStatus) {
    const x = COLOR_VARS[DIFF_TAG_TO_COLOR_VAR[ct.diffStatus]]
    spanStyle.backgroundColor = `var(${x})`
  }

  return (
    <WithTooltipOnHover
      mkTooltipContent={mkTooltip}
      onClick={(e, next) => {
        // On ctrl-click, if location is known, go to it in the editor
        if (e.ctrlKey || e.metaKey) {
          setHoverState(st => st === 'over' ? 'ctrlOver' : st)
          void fetchGoToLoc().then(loc => {
            if (loc === undefined) return
            void ec.revealPosition({ uri: loc.uri, ...loc.range.start })
          })
        }
        if (!e.ctrlKey) next(e)
      }}
    >
      <DetectHoverSpan
        setHoverState={setHoverState}
        className={spanClassName}
        style={spanStyle}
      >
        <InteractiveCode fmt={fmt} />
      </DetectHoverSpan>
    </WithTooltipOnHover>
  )
}

export interface InteractiveCodeProps {
  fmt: CodeWithInfos
}

/** Displays a {@link CodeWithInfos} obtained via RPC from the Lean server. */
export function InteractiveCode({fmt}: InteractiveCodeProps) {
  return <InteractiveTaggedText InnerTagUi={InteractiveCodeTag} fmt={fmt} />
}
