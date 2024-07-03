import * as React from 'react'

import {
    CodeWithInfos,
    DiffTag,
    getGoToLocation,
    InteractiveDiagnostics_infoToInteractive,
    SubexprInfo,
    TaggedText,
    TaggedText_stripTags,
} from '@leanprover/infoview-api'
import { marked } from 'marked'
import { Location } from 'vscode-languageserver-protocol'
import { ConfigContext, EditorContext } from './contexts'
import { GoalsLocation, LocationsContext } from './goalLocation'
import { useRpcSession } from './rpcSessions'
import { HoverState, TipChainContext, Tooltip } from './tooltips'
import { LogicalDomContext, mapRpcError, useAsync, useEvent, useLogicalDomObserver, useOnClickOutside } from './util'

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
export function InteractiveTaggedText<T>({ fmt, InnerTagUi }: InteractiveTaggedTextProps<T>) {
    if ('text' in fmt) return <>{fmt.text}</>
    else if ('append' in fmt)
        return (
            <>
                {fmt.append.map((a, i) => (
                    <InteractiveTaggedText key={i} fmt={a} InnerTagUi={InnerTagUi} />
                ))}
            </>
        )
    else if ('tag' in fmt) return <InnerTagUi fmt={fmt.tag[1]} tag={fmt.tag[0]} />
    else throw new Error(`malformed 'TaggedText': '${fmt}'`)
}

interface TypePopupContentsProps {
    info: SubexprInfo
}

function Markdown({ contents }: { contents: string }): JSX.Element {
    const renderer = new marked.Renderer()
    renderer.code = (code, lang) => {
        // todo: render Lean code blocks using the lean syntax.json
        return `<div class="font-code pre-wrap">${code}</div>`
    }
    renderer.codespan = code => {
        return `<code class="font-code">${code}</code>`
    }

    const markedOptions: marked.MarkedOptions = {}
    markedOptions.sanitizer = (html: string): string => {
        return ''
    }
    markedOptions.sanitize = true
    markedOptions.silent = true
    markedOptions.renderer = renderer

    // todo: vscode also has lots of post render sanitization and hooking up of href clicks and so on.
    // see https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/markdownRenderer.ts

    const renderedMarkdown = marked.parse(contents, markedOptions)
    return <div dangerouslySetInnerHTML={{ __html: renderedMarkdown }} />
    // handy for debugging:
    // return <div>{ renderedMarkdown } </div>
}

/** Shows `explicitValue : itsType` and a docstring if there is one. */
function TypePopupContents({ info }: TypePopupContentsProps) {
    const rs = useRpcSession()
    // When `err` is defined we show the error,
    // otherwise if `ip` is defined we show its contents,
    // otherwise a 'loading' message.
    const interactive = useAsync(() => InteractiveDiagnostics_infoToInteractive(rs, info.info), [rs, info.info])

    // Even when subexpressions are selectable in our parent component, it doesn't make sense
    // to select things inside the *type* of the parent, so we clear the context.
    // NOTE: selecting in the explicit term does make sense but it complicates the implementation
    // so let's not add it until someone really wants it.
    return (
        <LocationsContext.Provider value={undefined}>
            <div className="tooltip-code-content">
                {interactive.state === 'resolved' ? (
                    <>
                        <div className="font-code tl pre-wrap">
                            {interactive.value.exprExplicit && <InteractiveCode fmt={interactive.value.exprExplicit} />}{' '}
                            : {interactive.value.type && <InteractiveCode fmt={interactive.value.type} />}
                        </div>
                        {interactive.value.doc && (
                            <>
                                <hr />
                                <Markdown contents={interactive.value.doc} />
                            </>
                        )}
                        {info.diffStatus && (
                            <>
                                <hr />
                                <div>{DIFF_TAG_TO_EXPLANATION[info.diffStatus]}</div>
                            </>
                        )}
                    </>
                ) : interactive.state === 'rejected' ? (
                    <>Error: {mapRpcError(interactive.error).message}</>
                ) : (
                    <>Loading..</>
                )}
            </div>
        </LocationsContext.Provider>
    )
}

const DIFF_TAG_TO_CLASS: { [K in DiffTag]: string } = {
    wasChanged: 'inserted-text',
    willChange: 'removed-text',
    wasInserted: 'inserted-text',
    willInsert: 'inserted-text',
    willDelete: 'removed-text',
    wasDeleted: 'removed-text',
}

const DIFF_TAG_TO_EXPLANATION: { [K in DiffTag]: string } = {
    wasChanged: 'This subexpression has been modified.',
    willChange: 'This subexpression will be modified.',
    wasInserted: 'This subexpression has been inserted.',
    willInsert: 'This subexpression will be inserted.',
    wasDeleted: 'This subexpression has been removed.',
    willDelete: 'This subexpression will be deleted.',
}

/**
 * Tagged spans can be hovered over to display extra info stored in the associated `SubexprInfo`.
 * Moreover if this component is rendered in a context where locations can be selected, the span
 * can be shift-clicked to select it.
 */
function InteractiveCodeTag({ tag: ct, fmt }: InteractiveTagProps<SubexprInfo>) {
    const rs = useRpcSession()
    const ec = React.useContext(EditorContext)
    const htRef = React.useRef<HTMLSpanElement>(null)
    const [hoverState, setHoverState] = React.useState<HoverState>('off')
    const [goToDefErrorState, setGoToDefErrorState_] = React.useState<boolean>(false)
    const [goToDefErrorTooltipAnchorRef, setGoToDefErrorTooltipAnchorRef] = React.useState<HTMLSpanElement | null>(null)
    const setGoToDefErrorState: (isError: boolean) => void = React.useCallback(isError => {
        setGoToDefErrorState_(isError)
        if (isError) {
            setGoToDefErrorTooltipAnchorRef(htRef.current)
        }
    }, [])

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
        } catch (e) {
            console.error('Error in go-to-definition: ', JSON.stringify(e))
        }
        return undefined
    }, [rs, ct.info, goToLoc])
    // Eagerly fetch the location as soon as the pointer enters this area so that we can show
    // an underline if a jump target is available.
    React.useEffect(() => {
        if (hoverState === 'ctrlOver') void fetchGoToLoc()
    }, [hoverState, fetchGoToLoc])

    const execGoToLoc = React.useCallback(
        async (withError: boolean) => {
            const loc = await fetchGoToLoc()
            if (loc === undefined) {
                if (withError) {
                    setGoToDefErrorState(true)
                    setGoToDefErrorTooltipAnchorRef(htRef.current)
                }
                return
            }
            await ec.revealPosition({ uri: loc.uri, ...loc.range.start })
        },
        [fetchGoToLoc, ec, setGoToDefErrorState],
    )

    const locs = React.useContext(LocationsContext)
    const ourLoc =
        locs && locs.subexprTemplate && ct.subexprPos
            ? GoalsLocation.withSubexprPos(locs.subexprTemplate, ct.subexprPos)
            : undefined
    const isSelected = locs && ourLoc && locs.isSelected(ourLoc)

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

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /* SelectableLocation */
    const [slHoverState, setSLHoverState] = React.useState<HoverState>('off')
    let slSpanClassName: string = ''
    if (slHoverState !== 'off') {
        slSpanClassName += 'highlight '
    } else if (isSelected) {
        slSpanClassName += 'highlight-selected '
    }
    slSpanClassName += spanClassName

    const slSetHoverStateAll: React.Dispatch<React.SetStateAction<HoverState>> = React.useCallback(val => {
        setSLHoverState(val)
    }, [])

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /* DetectHoverSpan */
    const dhOnPointerEvent = (b: boolean, e: React.PointerEvent<HTMLSpanElement>) => {
        // It's more composable to let pointer events bubble up rather than to call `stopPropagation`,
        // but we only want to handle hovers in the innermost component. So we record that the
        // event was handled with a property.
        // The `contains` check ensures that the node hovered over is a child in the DOM
        // tree and not just a logical React child (see useLogicalDom and
        // https://reactjs.org/docs/portals.html#event-bubbling-through-portals).
        if (htRef.current && e.target instanceof Node && htRef.current.contains(e.target)) {
            if ('_DetectHoverSpanSeen' in e) return
            ;(e as any)._DetectHoverSpanSeen = {}
            if (!b) slSetHoverStateAll('off')
            else if (e.ctrlKey || e.metaKey) slSetHoverStateAll('ctrlOver')
            else slSetHoverStateAll('over')
        }
    }

    React.useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Control' || e.key === 'Meta') slSetHoverStateAll(st => (st === 'over' ? 'ctrlOver' : st))
        }

        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Control' || e.key === 'Meta') slSetHoverStateAll(st => (st === 'ctrlOver' ? 'over' : st))
        }

        // Note: In VSCode these events do not fire when the webview is not in focus.
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('keyup', onKeyUp)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
            document.removeEventListener('keyup', onKeyUp)
        }
    }, [slSetHoverStateAll])

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    /* WithTooltipOnHover */
    const htConfig = React.useContext(ConfigContext)

    // We are pinned when clicked, shown when hovered over, and otherwise hidden.
    type TooltipState = 'pin' | 'show' | 'hide'
    const [htState, setHTState_] = React.useState<TooltipState>('hide')
    const [hoverTooltipAnchorRef, setHoverTooltipAnchorRef] = React.useState<HTMLSpanElement | null>(null)
    const setHTState: (state: TooltipState) => void = React.useCallback(state => {
        setHTState_(state)
        if (state !== 'hide') {
            setHoverTooltipAnchorRef(htRef.current)
        }
    }, [])
    const htShouldShow = htState !== 'hide'

    const htTipChainCtx = React.useContext(TipChainContext)
    React.useEffect(() => {
        if (htState === 'pin') htTipChainCtx.pinParent()
    }, [htState, htTipChainCtx])
    const newHTTipChainCtx = React.useMemo(
        () => ({
            pinParent: () => {
                setHTState('pin')
                htTipChainCtx.pinParent()
            },
        }),
        [htTipChainCtx, setHTState],
    )

    // Note: because tooltips are attached to `document.body`, they are not descendants of the
    // hoverable area in the DOM tree. Thus the `contains` check fails for elements within tooltip
    // contents and succeeds for elements within the hoverable. We can use this to distinguish them.
    const htIsWithinHoverable = (el: EventTarget) => htRef.current && el instanceof Node && htRef.current.contains(el)
    const [htLogicalSpanElt, htLogicalDomStorage] = useLogicalDomObserver(htRef)

    // We use timeouts for debouncing hover events.
    const htTimeout = React.useRef<number>()
    const htClearTimeout = () => {
        if (htTimeout.current) {
            window.clearTimeout(htTimeout.current)
            htTimeout.current = undefined
        }
    }
    const htShowDelay = 500
    const htHideDelay = 300

    const htIsModifierHeld = (e: React.MouseEvent) => e.altKey || e.ctrlKey || e.shiftKey || e.metaKey

    const htOnClick = (e: React.MouseEvent<HTMLSpanElement>) => {
        htClearTimeout()
        setHTState(htState === 'pin' ? 'hide' : 'pin')
        e.stopPropagation()
    }

    const htOnClickOutside = React.useCallback(() => {
        htClearTimeout()
        setHTState('hide')
        setGoToDefErrorState(false)
    }, [setHTState, setGoToDefErrorState])
    useOnClickOutside(htLogicalSpanElt, htOnClickOutside)

    const htIsPointerOverTooltip = React.useRef<boolean>(false)
    const htStartShowTimeout = () => {
        htClearTimeout()
        if (!htConfig.showTooltipOnHover) return
        htTimeout.current = window.setTimeout(() => {
            setHTState(htState === 'hide' ? 'show' : htState)
            htTimeout.current = undefined
        }, htShowDelay)
    }
    const htStartHideTimeout = () => {
        htClearTimeout()
        htTimeout.current = window.setTimeout(() => {
            if (!htIsPointerOverTooltip.current) setHTState(htState === 'show' ? 'hide' : htState)
            htTimeout.current = undefined
        }, htHideDelay)
    }

    const htOnPointerEnter = (e: React.PointerEvent<HTMLSpanElement>) => {
        htIsPointerOverTooltip.current = true
        htClearTimeout()
    }

    const htOnPointerLeave = (e: React.PointerEvent<HTMLSpanElement>) => {
        htIsPointerOverTooltip.current = false
        htStartHideTimeout()
    }

    function htGuardMouseEvent(
        act: (_: React.MouseEvent<HTMLSpanElement>) => void,
        e: React.MouseEvent<HTMLSpanElement>,
    ) {
        if ('_WithTooltipOnHoverSeen' in e) return
        if (!htIsWithinHoverable(e.target)) return
        ;(e as any)._WithTooltipOnHoverSeen = {}
        act(e)
    }

    return (
        <LogicalDomContext.Provider value={htLogicalDomStorage}>
            <span
                ref={htRef}
                className={slSpanClassName}
                data-vscode-context={JSON.stringify(vscodeContext)}
                data-has-tooltip-on-hover
                onClick={e => {
                    // On shift-click, if we are in a context where selecting subexpressions makes sense,
                    // (un)select the current subexpression.
                    if (e.shiftKey && locs && ourLoc) {
                        locs.setSelected(ourLoc, on => !on)
                        e.stopPropagation()
                        return
                    }
                    htGuardMouseEvent(e => {
                        // On ctrl-click or ⌘-click, if location is known, go to it in the editor
                        if (e.ctrlKey || e.metaKey) {
                            setHoverState(st => (st === 'over' ? 'ctrlOver' : st))
                            void execGoToLoc(false)
                        } else if (!e.shiftKey) htOnClick(e)
                    }, e)
                    if (!window.getSelection()?.toString()) setGoToDefErrorState(false)
                }}
                onPointerDown={e => {
                    // We have special handling for some modifier+click events, so prevent default browser
                    // events from interfering when a modifier is held.
                    if (htIsModifierHeld(e)) e.preventDefault()
                }}
                onPointerOver={e => {
                    dhOnPointerEvent(true, e)
                    if (!htIsModifierHeld(e)) {
                        htGuardMouseEvent(_ => htStartShowTimeout(), e)
                    }
                }}
                onPointerOut={e => {
                    dhOnPointerEvent(false, e)
                    htGuardMouseEvent(_ => htStartHideTimeout(), e)
                }}
                onPointerMove={e => {
                    if (e.ctrlKey || e.metaKey) slSetHoverStateAll(st => (st === 'over' ? 'ctrlOver' : st))
                    else slSetHoverStateAll(st => (st === 'ctrlOver' ? 'over' : st))
                }}
                onContextMenu={e => {
                    // Mark the event as seen so that parent handlers skip it.
                    // We cannot use `stopPropagation` as that prevents the VSC context menu from showing up.
                    if ('_InteractiveCodeTagSeen' in e) return
                    ;(e as any)._InteractiveCodeTagSeen = {}
                    if (!(e.target instanceof Node)) return
                    if (!e.currentTarget.contains(e.target)) return
                    // Select the pretty-printed code.
                    const sel = window.getSelection()
                    if (!sel) return
                    sel.removeAllRanges()
                    sel.selectAllChildren(e.currentTarget)
                }}
            >
                {goToDefErrorState && (
                    <Tooltip
                        reference={goToDefErrorTooltipAnchorRef}
                    >{`No definition found for '${TaggedText_stripTags(fmt)}'`}</Tooltip>
                )}
                {htShouldShow && (
                    <TipChainContext.Provider value={newHTTipChainCtx}>
                        <Tooltip
                            reference={hoverTooltipAnchorRef}
                            onPointerEnter={htOnPointerEnter}
                            onPointerLeave={htOnPointerLeave}
                        >
                            <TypePopupContents info={ct} />
                        </Tooltip>
                    </TipChainContext.Provider>
                )}
                <InteractiveTaggedText fmt={fmt} InnerTagUi={InteractiveCodeTag} />
            </span>
        </LogicalDomContext.Provider>
    )
}

export type InteractiveCodeProps = InteractiveTextComponentProps<SubexprInfo>

/** Displays a {@link CodeWithInfos} obtained via RPC from the Lean server. */
export function InteractiveCode(props: InteractiveCodeProps) {
    return (
        <span className="font-code">
            <InteractiveTaggedText {...props} InnerTagUi={InteractiveCodeTag} />
        </span>
    )
}
