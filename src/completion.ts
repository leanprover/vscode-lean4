import * as vscode from 'vscode';
import {CompletionItemProvider} from 'vscode';
import {LEAN_MODE} from './constants';
import {Server} from './server';
import {isInputCompletion} from './util';

const keywords = [
    'theorem', 'lemma', 'axiom', 'axioms', 'variable', 'protected', 'private',
    'def', 'meta', 'mutual', 'example', 'noncomputable',
    'variables', 'parameter', 'parameters', 'constant', 'constants',
    'using_well_founded',
    'end', 'namespace', 'section', 'prelude',
    'import', 'inductive', 'coinductive', 'structure', 'class', 'universe', 'universes', 'local',
    'precedence', 'reserve', 'infixl', 'infixr', 'infix', 'postfix', 'prefix', 'notation',
    'set_option', 'open', 'export',
    'attribute', 'instance', 'include', 'omit',
    'declare_trace', 'add_key_equivalence',
    'run_cmd', '#check', '#reduce', '#eval', '#print', '#help', '#exit',
    '#compile', '#unify',

    'fun', 'Pi', 'let', 'in', 'at',
    'have', 'assume', 'show', 'suffices',
    'do', 'if', 'then', 'else', 'by',
    'hiding', 'replacing',
    'from',
    'Type', 'Sort',
    'with', 'without',
    'calc',
    'begin', 'using',
    'sorry',
    'match',
    'renaming', 'extends',
];

export class LeanCompletionItemProvider implements vscode.CompletionItemProvider {
    server: Server;

    constructor(server: Server) {
        this.server = server;
    }

    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position):
            Promise<vscode.CompletionItem[]> {
        // TODO(gabriel): use LeanInputAbbreviator.active() instead
        if (!isInputCompletion(document, position)) {
            const message = await this.server.complete(document.fileName, position.line + 1, position.character);
            const completions: vscode.CompletionItem[] = [];
            for (const completion of message.completions) {
                const item = new vscode.CompletionItem(completion.text, vscode.CompletionItemKind.Function);
                item.range = new vscode.Range(position.translate(0, -message.prefix.length), position);
                if (completion.tactic_params) {
                    item.detail = completion.tactic_params.join(' ');
                } else {
                    item.detail = completion.type;
                }
                item.documentation = completion.doc;
                completions.push(item);
            }
            for (const kw of keywords) {
                completions.push(
                        new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword));
            }
            return completions;
        } else {
            return null;
        }
    }
}
