import * as React from 'react'

import { EditorContext, RpcContext } from './contexts'
import { DocumentPosition, useAsync, mapRpcError } from './util'
import { SubexprInfo, CodeWithInfos, InteractiveDiagnostics_infoToInteractive, getGoToLocation, TaggedText } from './rpcInterface'
import { DetectHoverSpan, HoverState, WithTooltipOnHover } from './tooltips'
import { Location } from 'vscode-languageserver-protocol'
import { marked } from 'marked'

export interface InteractiveTextComponentProps<T> {
  pos: DocumentPosition
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
export function InteractiveTaggedText<T>({pos, fmt, InnerTagUi}: InteractiveTaggedTextProps<T>) {
  if ('text' in fmt) return <>{fmt.text}</>
  else if ('append' in fmt) return <>
    {fmt.append.map((a, i) => <InteractiveTaggedText key={i} pos={pos} fmt={a} InnerTagUi={InnerTagUi} />)}
  </>
  else if ('tag' in fmt) return <InnerTagUi pos={pos} fmt={fmt.tag[1]} tag={fmt.tag[0]} />
  else throw new Error(`malformed 'TaggedText': '${fmt}'`)
}

interface TypePopupContentsProps {
  pos: DocumentPosition
  info: SubexprInfo
  redrawTooltip: () => void
}

function parseHrefAndDimensions(href: string): { href: string; dimensions: string[] } {
	const dimensions: string[] = [];
	const splitted = href.split('|').map(s => s.trim());
	href = splitted[0];
	const parameters = splitted[1];
	if (parameters) {
		const heightFromParams = /height=(\d+)/.exec(parameters);
		const widthFromParams = /width=(\d+)/.exec(parameters);
		const height = heightFromParams ? heightFromParams[1] : '';
		const width = widthFromParams ? widthFromParams[1] : '';
		const widthIsFinite = isFinite(parseInt(width));
		const heightIsFinite = isFinite(parseInt(height));
		if (widthIsFinite) {
			dimensions.push(`width="${width}"`);
		}
		if (heightIsFinite) {
			dimensions.push(`height="${height}"`);
		}
	}
	return { href, dimensions };
}

function escapeDoubleQuotes(input: string) {
	return input.replace(/"/g, '&quot;');
}

function removeMarkdownEscapes(text: string): string {
	if (!text) {
		return text;
	}
	return text.replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1');
}

function renderCodeBlock(lang: string, code: string) : string {
  // todo: render Lean code blocks using the lean syntax.json
  return `<div>${code}</div>`
}

function renderMarkdown(doc: string){
  const renderer = new marked.Renderer();
  renderer.image = (href: string, title: string, text: string) => {
		let dimensions: string[] = [];
		let attributes: string[] = [];
		if (href) {
			({ href, dimensions } = parseHrefAndDimensions(href));
			attributes.push(`src="${escapeDoubleQuotes(href)}"`);
		}
		if (text) {
			attributes.push(`alt="${escapeDoubleQuotes(text)}"`);
		}
		if (title) {
			attributes.push(`title="${escapeDoubleQuotes(title)}"`);
		}
		if (dimensions.length) {
			attributes = attributes.concat(dimensions);
		}
		return '<img ' + attributes.join(' ') + '>';
	};
	renderer.link = (href, title, text): string => {
		if (typeof href !== 'string') {
			return '';
		}

		// Remove markdown escapes. Workaround for https://github.com/chjj/marked/issues/829
		if (href === text) { // raw link case
			text = removeMarkdownEscapes(text);
		}

		title = typeof title === 'string' ? escapeDoubleQuotes(removeMarkdownEscapes(title)) : '';
		href = removeMarkdownEscapes(href);

		// HTML Encode href
		href = href.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
		return `<a href="${href}" title="${title || href}">${text}</a>`;
	};
	renderer.paragraph = (text): string => {
		return `<p>${text}</p>`;
	};

  renderer.code = (code, lang) => {
    const id : string = lang ? lang : '';
    const formatted = renderCodeBlock(id, code);
		return `<div class="font-code tl pre-wrap" data-code="${id}">${formatted}</div>`;
	}

  const markedOptions: marked.MarkedOptions = {}
  markedOptions.sanitizer = (html: string): string => {
    const match = html.match(/^(<span[^>]+>)|(<\/\s*span>)$/);
    return match ? html : '';
  };
  markedOptions.sanitize = true;
  markedOptions.silent = true;
  markedOptions.renderer = renderer;

  // todo: vscode also has lots of post render sanitization and hooking up of href clicks and so on.
  // See https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/markdownRenderer.ts

  // TODO: also need to provide all the vscode CSS styles that are relevant to all HTML tags that
  // can be returned by the markdown parser, like lists and tables.

  const renderedMarkdown = marked.parse(doc, markedOptions);
  return <div dangerouslySetInnerHTML={{ __html: renderedMarkdown }} />
  // return <div>{ renderedMarkdown } </div>
}

/** Shows `explicitValue : itsType` and a docstring if there is one. */
function TypePopupContents({ pos, info, redrawTooltip }: TypePopupContentsProps) {
  const rs = React.useContext(RpcContext)
  // When `err` is defined we show the error,
  // otherwise if `ip` is defined we show its contents,
  // otherwise a 'loading' message.
  const [_, ip, err] = useAsync(
    () => InteractiveDiagnostics_infoToInteractive(rs, pos, info.info),
    [rs, pos.uri, pos.line, pos.character, info.info, info.subexprPos])

  // We let the tooltip know to redo its layout whenever our contents change.
  React.useEffect(() => redrawTooltip(), [ip, err, redrawTooltip])

  return <>
    {ip && <>
      <div className="font-code tl pre-wrap">
      {ip.exprExplicit && <InteractiveCode pos={pos} fmt={ip.exprExplicit} />} : {ip.type && <InteractiveCode pos={pos} fmt={ip.type} />}
      </div>
      {ip.doc && <hr />}
      {ip.doc && ip.doc && renderMarkdown(ip.doc)}
    </>}
    {err && <>Error: {mapRpcError(err).message}</>}
    {(!ip && !err) && <>Loading..</>}
  </>
}

/** Tagged spans can be hovered over to display extra info stored in the associated `SubexprInfo`. */
function InteractiveCodeTag({pos, tag: ct, fmt}: InteractiveTagProps<SubexprInfo>) {
  const mkTooltip = React.useCallback((redrawTooltip: () => void) =>
    <div>
      <TypePopupContents pos={pos} info={ct}
        redrawTooltip={redrawTooltip} />
    </div>, [pos.uri, pos.line, pos.character, ct.info])

  // We mimick the VSCode ctrl-hover and ctrl-click UI for go-to-definition
  const rs = React.useContext(RpcContext)
  const ec = React.useContext(EditorContext)
  const [hoverState, setHoverState] = React.useState<HoverState>('off')

  const [goToLoc, setGoToLoc] = React.useState<Location | undefined>(undefined)
  const fetchGoToLoc = React.useCallback(async () => {
    if (goToLoc !== undefined) return goToLoc
    try {
      const lnks = await getGoToLocation(rs, pos, 'definition', ct.info)
      if (lnks !== undefined && lnks.length > 0) {
        const loc = { uri: lnks[0].targetUri, range: lnks[0].targetSelectionRange }
        setGoToLoc(loc)
        return loc
      }
    } catch(e) {
      console.error('Error in go-to-definition: ', JSON.stringify(e))
    }
    return undefined
  }, [rs, pos.uri, pos.line, pos.character, ct.info, goToLoc])
  React.useEffect(() => { if (hoverState === 'ctrlOver') void fetchGoToLoc() }, [hoverState])

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
        className={'highlightable '
                    + (hoverState !== 'off' ? 'highlight ' : '')
                    + (hoverState === 'ctrlOver' && goToLoc !== undefined ? 'underline ' : '')}
      >
        <InteractiveCode pos={pos} fmt={fmt} />
      </DetectHoverSpan>
    </WithTooltipOnHover>
  )
}

interface InteractiveCodeProps {
  pos: DocumentPosition
  fmt: CodeWithInfos
}

export function InteractiveCode(props: InteractiveCodeProps) {
  return <InteractiveTaggedText InnerTagUi={InteractiveCodeTag} fmt={props.fmt} pos={props.pos} />
}
