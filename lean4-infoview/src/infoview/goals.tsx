import {
    InfoviewActionKind,
    InfoviewConfig,
    InteractiveGoal,
    InteractiveGoals,
    InteractiveHypothesisBundle,
    InteractiveHypothesisBundle_nonAnonymousNames,
    MVarId,
    TaggedText_stripTags,
} from '@leanprover/infoview-api'
import * as React from 'react'
import { Details } from './collapsing'
import { ConfigContext, EditorContext } from './contexts'
import { Locations, LocationsContext, SelectableLocationSettings, useSelectableLocation } from './goalLocation'
import { useHoverHighlight } from './hoverHighlight'
import { InteractiveCode } from './interactiveCode'
import { WithTooltipOnHover } from './tooltips'
import { preventClickOnTextSelection, preventDoubleClickTextSelection, useEvent } from './util'

/** Returns true if `h` is inaccessible according to Lean's default name rendering. */
function isInaccessibleName(h: string): boolean {
    return h.indexOf('✝') >= 0
}

function goalToString(g: InteractiveGoal): string {
    let ret = ''

    if (g.userName) {
        ret += `case ${g.userName}\n`
    }

    for (const h of g.hyps) {
        const names = InteractiveHypothesisBundle_nonAnonymousNames(h).join(' ')
        ret += `${names} : ${TaggedText_stripTags(h.type)}`
        if (h.val) {
            ret += ` := ${TaggedText_stripTags(h.val)}`
        }
        ret += '\n'
    }

    ret += `⊢ ${TaggedText_stripTags(g.type)}`

    return ret
}

export function goalsToString(goals: InteractiveGoals): string {
    return goals.goals.map(goalToString).join('\n\n')
}

interface GoalSettingsState {
    /** If true reverse the list of hypotheses, if false present the order received from LSP. */
    reverse: boolean
    /** If true hide the names of goals, otherwise show them. */
    hideGoalNames: boolean
    /** If true emphasize the first goal, otherwise don't emphasize it. */
    emphasizeFirstGoal: boolean
    /** If true show hypotheses that have isType=True, otherwise hide them. */
    showType: boolean
    /** If true show hypotheses that have isInstance=True, otherwise hide them. */
    showInstance: boolean
    /** If true show hypotheses that contain a dagger in the name, otherwise hide them. */
    showHiddenAssumption: boolean
    /** If true show the bodies of let-values, otherwise hide them. */
    showLetValue: boolean
}

function goalSettingsStateOfConfig(config: InfoviewConfig): GoalSettingsState {
    return {
        reverse: config.reverseTacticState,
        hideGoalNames: !config.showGoalNames,
        emphasizeFirstGoal: config.emphasizeFirstGoal,
        showType: !config.hideTypeAssumptions,
        showInstance: !config.hideInstanceAssumptions,
        showHiddenAssumption: !config.hideInaccessibleAssumptions,
        showLetValue: !config.hideLetValues,
    }
}

function getFilteredHypotheses(
    hyps: InteractiveHypothesisBundle[],
    settings: GoalSettingsState,
): InteractiveHypothesisBundle[] {
    return hyps.reduce((acc: InteractiveHypothesisBundle[], h) => {
        if (h.isInstance && !settings.showInstance) return acc
        if (h.isType && !settings.showType) return acc
        const names = settings.showHiddenAssumption ? h.names : h.names.filter(n => !isInaccessibleName(n))
        const hNew: InteractiveHypothesisBundle = settings.showLetValue
            ? { ...h, names }
            : { ...h, names, val: undefined }
        if (names.length !== 0) acc.push(hNew)
        return acc
    }, [])
}

interface HypNameProps {
    name: string
    isInserted: boolean
    isRemoved: boolean
    mvarId?: string | undefined
    fvarId?: string | undefined
}

function HypName({ name, isInserted, isRemoved, mvarId, fvarId }: HypNameProps) {
    const ref = React.useRef<HTMLSpanElement>(null)

    const locs = React.useContext(LocationsContext)

    const hhl = useHoverHighlight({
        ref,
        highlightOnHover: locs !== undefined && mvarId !== undefined && fvarId !== undefined,
        underlineOnModHover: false,
    })

    let selectableLocationSettings: SelectableLocationSettings
    if (mvarId !== undefined && fvarId !== undefined) {
        selectableLocationSettings = { isSelectable: true, loc: { mvarId, loc: { hyp: fvarId } } }
    } else {
        selectableLocationSettings = { isSelectable: false }
    }
    const sl = useSelectableLocation(selectableLocationSettings)

    const namecls: string =
        (isInserted ? 'inserted-text ' : '') +
        (isRemoved ? 'removed-text ' : '') +
        (isInaccessibleName(name) ? 'goal-inaccessible ' : '') +
        hhl.className +
        sl.className
    return (
        <>
            <span
                ref={ref}
                className={namecls}
                data-vscode-context={JSON.stringify(sl.dataVscodeContext)}
                onPointerOver={e => hhl.onPointerOver(e)}
                onPointerOut={e => hhl.onPointerOut(e)}
                onPointerMove={e => hhl.onPointerMove(e)}
                onClick={e => sl.onClick(e)}
                onPointerDown={e => sl.onPointerDown(e)}
            >
                {name}
            </span>
            &nbsp;
        </>
    )
}

interface HypProps {
    hyp: InteractiveHypothesisBundle
    mvarId?: MVarId
}

function Hyp({ hyp: h, mvarId }: HypProps) {
    const locs = React.useContext(LocationsContext)

    const names = InteractiveHypothesisBundle_nonAnonymousNames(h).map((n, i) => (
        <HypName
            name={n}
            isInserted={!!h.isInserted}
            isRemoved={!!h.isRemoved}
            mvarId={mvarId}
            fvarId={h.fvarIds?.at(i)}
            key={i}
        ></HypName>
    ))

    const typeLocs: Locations | undefined = React.useMemo(
        () =>
            locs && mvarId && h.fvarIds && h.fvarIds.length > 0
                ? { ...locs, subexprTemplate: { mvarId, loc: { hypType: [h.fvarIds[0], ''] } } }
                : undefined,
        [locs, mvarId, h.fvarIds],
    )

    const valLocs: Locations | undefined = React.useMemo(
        () =>
            h.val && locs && mvarId && h.fvarIds && h.fvarIds.length > 0
                ? { ...locs, subexprTemplate: { mvarId, loc: { hypValue: [h.fvarIds[0], ''] } } }
                : undefined,
        [h.val, locs, mvarId, h.fvarIds],
    )

    return (
        <div>
            <strong className="goal-hyp">{names}</strong>
            :&nbsp;
            <LocationsContext.Provider value={typeLocs}>
                <InteractiveCode fmt={h.type} />
            </LocationsContext.Provider>
            {h.val && (
                <LocationsContext.Provider value={valLocs}>
                    &nbsp;:=&nbsp;
                    <InteractiveCode fmt={h.val} />
                </LocationsContext.Provider>
            )}
        </div>
    )
}

interface GoalProps {
    goal: InteractiveGoal
    settings: GoalSettingsState
    additionalClassNames: string
}

/**
 * Displays the hypotheses, target type and optional case label of a goal according to the
 * provided `filter`. */
export const Goal = React.memo((props: GoalProps) => {
    const { goal, settings, additionalClassNames } = props
    const config = React.useContext(ConfigContext)

    const prefix = goal.goalPrefix ?? '⊢ '
    const filteredList = getFilteredHypotheses(goal.hyps, settings)
    const hyps = settings.reverse ? filteredList.slice().reverse() : filteredList
    const locs = React.useContext(LocationsContext)
    const goalLocs = React.useMemo(
        () =>
            locs && goal.mvarId
                ? { ...locs, subexprTemplate: { mvarId: goal.mvarId, loc: { target: '' } } }
                : undefined,
        [locs, goal.mvarId],
    )
    const goalLi = (
        <div key={'goal'} data-is-goal>
            <strong className="goal-vdash">{prefix}</strong>
            <LocationsContext.Provider value={goalLocs}>
                <InteractiveCode fmt={goal.type} />
            </LocationsContext.Provider>
        </div>
    )

    let cn = 'font-code tl pre-wrap bl bw1 pl1 b--transparent mb3 ' + additionalClassNames
    if (props.goal.isInserted) cn += ' b--inserted '
    if (props.goal.isRemoved) cn += ' b--removed '

    const children: React.ReactNode[] = [
        settings.reverse && goalLi,
        hyps.map((h, i) => <Hyp hyp={h} mvarId={goal.mvarId} key={i} />),
        !settings.reverse && goalLi,
    ]

    if (goal.userName && !settings.hideGoalNames) {
        return (
            <details open className={cn}>
                <summary
                    className="mv1 pointer"
                    onClick={e => preventClickOnTextSelection(e)}
                    onMouseDown={e => preventDoubleClickTextSelection(e)}
                >
                    <strong className="goal-case">case </strong>
                    {goal.userName}
                </summary>
                {children}
            </details>
        )
    } else return <div className={cn}>{children}</div>
})

interface GoalsProps {
    goals: InteractiveGoals
    settings: GoalSettingsState
    /** Whether or not to display the number of goals. */
    displayCount: boolean
}

function Goals({ goals, settings, displayCount }: GoalsProps) {
    const nGoals = goals.goals.length
    const config = React.useContext(ConfigContext)
    if (nGoals === 0) {
        return <strong className="db2 mb2 goal-goals">No goals</strong>
    } else {
        const unemphasizeCn = 'o-70 font-size-code-smaller'
        return (
            <>
                {displayCount && (
                    <strong className="db mb2 goal-goals">
                        {nGoals} {1 < nGoals ? 'goals' : 'goal'}
                    </strong>
                )}
                {goals.goals.map((g, i) => (
                    <Goal
                        key={i}
                        goal={g}
                        settings={settings}
                        additionalClassNames={i !== 0 && settings.emphasizeFirstGoal ? unemphasizeCn : ''}
                    />
                ))}
            </>
        )
    }
}

interface FilteredGoalsProps {
    /** Components to render in the header. */
    headerChildren: React.ReactNode
    /**
     * When this is `undefined`, the component will not appear at all but will remember its state
     * by virtue of still being mounted in the React tree. When it does appear again, the filter
     * settings and collapsed state will be as before. */
    goals?: InteractiveGoals
    /** Whether or not to display the number of goals. */
    displayCount: boolean
    /** Whether the list of goals should be expanded on first render. */
    initiallyOpen: boolean
    /** If specified, the display will be toggled (collapsed/expanded) when this action is requested
     * by the user. */
    togglingAction?: InfoviewActionKind
}

/**
 * Display goals together with a header containing the provided children as well as buttons
 * to control how the goals are displayed.
 */
export const FilteredGoals = React.memo(
    ({ headerChildren, goals, displayCount, initiallyOpen, togglingAction }: FilteredGoalsProps) => {
        const ec = React.useContext(EditorContext)
        const config = React.useContext(ConfigContext)

        const [goalSettings, setGoalSettings] = React.useState<GoalSettingsState>(goalSettingsStateOfConfig(config))

        const goalSettingsDifferFromDefaultConfig =
            JSON.stringify(goalSettings) !== JSON.stringify(goalSettingsStateOfConfig(config))
        const disabledSaveStyle: React.CSSProperties = goalSettingsDifferFromDefaultConfig
            ? {}
            : { color: 'var(--vscode-disabledForeground)', pointerEvents: 'none' }

        const saveConfig = React.useCallback(async () => {
            await ec.api.saveConfig({
                ...config,
                reverseTacticState: goalSettings.reverse,
                showGoalNames: !goalSettings.hideGoalNames,
                emphasizeFirstGoal: goalSettings.emphasizeFirstGoal,
                hideTypeAssumptions: !goalSettings.showType,
                hideInstanceAssumptions: !goalSettings.showInstance,
                hideInaccessibleAssumptions: !goalSettings.showHiddenAssumption,
                hideLetValues: !goalSettings.showLetValue,
            })
        }, [config, ec.api, goalSettings])

        const mkSettingButton = (
            settingFn: React.SetStateAction<GoalSettingsState>,
            filledFn: (_: GoalSettingsState) => boolean,
            name: string,
        ) => (
            <a
                className="link pointer tooltip-menu-content non-selectable"
                onClick={_ => {
                    setGoalSettings(settingFn)
                }}
            >
                <span
                    className={
                        'tooltip-menu-icon codicon ' + (filledFn(goalSettings) ? 'codicon-check ' : 'codicon-blank ')
                    }
                >
                    &nbsp;
                </span>
                <span className="tooltip-menu-text ">{name}</span>
            </a>
        )
        const filterMenu = (
            <span>
                {mkSettingButton(
                    s => ({ ...s, reverse: !s.reverse }),
                    gs => gs.reverse,
                    'Display target before assumptions',
                )}
                <br />
                {mkSettingButton(
                    s => ({ ...s, showType: !s.showType }),
                    gs => !gs.showType,
                    'Hide type assumptions',
                )}
                <br />
                {mkSettingButton(
                    s => ({ ...s, showInstance: !s.showInstance }),
                    gs => !gs.showInstance,
                    'Hide instance assumptions',
                )}
                <br />
                {mkSettingButton(
                    s => ({ ...s, showHiddenAssumption: !s.showHiddenAssumption }),
                    gs => !gs.showHiddenAssumption,
                    'Hide inaccessible assumptions',
                )}
                <br />
                {mkSettingButton(
                    s => ({ ...s, showLetValue: !s.showLetValue }),
                    gs => !gs.showLetValue,
                    'Hide let-values',
                )}
                <br />
                {mkSettingButton(
                    s => ({ ...s, hideGoalNames: !s.hideGoalNames }),
                    gs => gs.hideGoalNames,
                    'Hide goal names',
                )}
                <br />
                {mkSettingButton(
                    s => ({ ...s, emphasizeFirstGoal: !s.emphasizeFirstGoal }),
                    gs => gs.emphasizeFirstGoal,
                    'Emphasize first goal',
                )}
                <br className="saveConfigLineBreak" style={disabledSaveStyle} />
                <a
                    className="link pointer tooltip-menu-content saveConfigButton non-selectable"
                    style={disabledSaveStyle}
                    onClick={_ => saveConfig()}
                >
                    <span className="tooltip-menu-icon codicon codicon-save">&nbsp;</span>
                    <span className="tooltip-menu-text">Save current settings to default settings</span>
                </a>
            </span>
        )

        const settingsButton = (
            <WithTooltipOnHover tooltipChildren={filterMenu} className="dim ">
                <a className={'link pointer mh2 codicon codicon-settings-gear'} />
            </WithTooltipOnHover>
        )

        const context: { [k: string]: any } = {}
        const id = React.useId()
        const useContextMenuEvent = (
            name: string,
            action: () => void,
            isEnabled: boolean,
            dependencies?: React.DependencyList,
        ) => {
            if (isEnabled) {
                context[name + 'Id'] = id
            }
            useEvent(ec.events.clickedContextMenu, _ => action(), dependencies, `${name}:${id}`)
        }
        const useSettingsContextMenuEvent = (name: string, setting: any, isEnabled: boolean) =>
            useContextMenuEvent(name, () => setGoalSettings(s => ({ ...s, ...setting })), isEnabled)

        useSettingsContextMenuEvent('displayTargetBeforeAssumptions', { reverse: true }, !goalSettings.reverse)
        useSettingsContextMenuEvent('displayAssumptionsBeforeTarget', { reverse: false }, goalSettings.reverse)
        useSettingsContextMenuEvent('hideTypeAssumptions', { showType: false }, goalSettings.showType)
        useSettingsContextMenuEvent('showTypeAssumptions', { showType: true }, !goalSettings.showType)
        useSettingsContextMenuEvent('hideInstanceAssumptions', { showInstance: false }, goalSettings.showInstance)
        useSettingsContextMenuEvent('showInstanceAssumptions', { showInstance: true }, !goalSettings.showInstance)
        useSettingsContextMenuEvent(
            'hideInaccessibleAssumptions',
            { showHiddenAssumption: false },
            goalSettings.showHiddenAssumption,
        )
        useSettingsContextMenuEvent(
            'showInaccessibleAssumptions',
            { showHiddenAssumption: true },
            !goalSettings.showHiddenAssumption,
        )
        useSettingsContextMenuEvent('hideLetValues', { showLetValues: false }, goalSettings.showLetValue)
        useSettingsContextMenuEvent('showLetValues', { showLetValues: true }, !goalSettings.showLetValue)
        useSettingsContextMenuEvent('hideGoalNames', { hideGoalNames: true }, !goalSettings.hideGoalNames)
        useSettingsContextMenuEvent('showGoalNames', { hideGoalNames: false }, goalSettings.hideGoalNames)
        useSettingsContextMenuEvent(
            'emphasizeFirstGoal',
            { emphasizeFirstGoal: true },
            !goalSettings.emphasizeFirstGoal,
        )
        useSettingsContextMenuEvent(
            'deemphasizeFirstGoal',
            { emphasizeFirstGoal: false },
            goalSettings.emphasizeFirstGoal,
        )
        useContextMenuEvent('saveSettings', () => saveConfig(), goalSettingsDifferFromDefaultConfig, [saveConfig])
        useContextMenuEvent(
            'copyState',
            () => {
                if (goals !== undefined) {
                    void ec.api.copyToClipboard(goalsToString(goals))
                }
            },
            goals !== undefined,
        )

        const setOpenRef = React.useRef<React.Dispatch<React.SetStateAction<boolean>>>()
        useEvent(
            ec.events.requestedAction,
            _ => {
                if (togglingAction !== undefined && setOpenRef.current !== undefined) {
                    setOpenRef.current(t => !t)
                }
            },
            [setOpenRef, togglingAction],
            togglingAction,
        )

        return (
            <div style={goals !== undefined ? {} : { display: 'none' }} data-vscode-context={JSON.stringify(context)}>
                <Details setOpenRef={r => (setOpenRef.current = r)} initiallyOpen={initiallyOpen}>
                    <>
                        {headerChildren}
                        <span
                            className="fr"
                            onClick={e => {
                                e.preventDefault()
                            }}
                        >
                            {settingsButton}
                        </span>
                    </>
                    <div className="ml1">
                        {goals && <Goals goals={goals} settings={goalSettings} displayCount={displayCount}></Goals>}
                    </div>
                </Details>
            </div>
        )
    },
)
