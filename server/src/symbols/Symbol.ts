import {
    BaseSymbol,
    ScopedSymbol,
    MethodSymbol as BaseMethodSymbol,
    ParameterSymbol,
    TypedSymbol,
    IType,
    TypeKind,
    ReferenceKind,
    SymbolConstructor,
    IScopedSymbol,
} from "antlr4-c3";
import { SymbolKind } from "../types";
import * as vscodelang from "vscode-languageserver";
import { ContextSymbolTable } from "../backend/ContextSymbolTable";
import {
    AssignmentExpressionContext,
    IdentifierExpressionContext,
    IncludeDirectiveContext,
    InheritStatementContext,
} from "../parser3/LPCParser";
import {
    EvalScope,
    IEvaluatableSymbol,
    IFoldableSymbol,
    IKindSymbol,
    LpcBaseSymbol,
    getSymbolsOfTypeSync,
    isInstanceOfIEvaluatableSymbol,
} from "./base";
import { VariableSymbol } from "./variableSymbol";

export class IdentifierSymbol extends LpcBaseSymbol<IdentifierExpressionContext> {
    public get kind() {
        return SymbolKind.Keyword;
    }
}
export class IncludeSymbol extends LpcBaseSymbol<IncludeDirectiveContext> {
    public get kind() {
        return SymbolKind.Include;
    }
}
export class InheritSymbol extends LpcBaseSymbol<InheritStatementContext> {
    public get kind() {
        return SymbolKind.Inherit;
    }
}

export class MethodParameterSymbol
    extends ParameterSymbol
    implements IKindSymbol, IEvaluatableSymbol
{
    eval() {
        return this.value;
    }

    public get kind() {
        return SymbolKind.Variable;
    }
}

export class MethodSymbol
    extends BaseMethodSymbol
    implements IFoldableSymbol, IKindSymbol, IEvaluatableSymbol
{
    public scope = new Map<string, VariableSymbol>();

    constructor(
        name: string,
        returnType?: IType,
        public functionModifiers?: Set<string>
    ) {
        super(name, returnType);
    }

    eval(paramScope: Map<string, IEvaluatableSymbol>) {
        // start with program scope

        this.scope = new Map<string, VariableSymbol>();
        paramScope.forEach((value, key) => {
            this.scope.set(key, value as VariableSymbol);
        });

        for (const child of this.children) {
            if (isInstanceOfIEvaluatableSymbol(child)) {
                child.eval(this.scope);
            } else {
                console.warn("Non eval symbol detected in method body", child);
            }
        }
    }

    public get kind() {
        return SymbolKind.Method;
    }

    public getParametersSync() {
        return getSymbolsOfTypeSync(this, MethodParameterSymbol);
    }

    foldingRange: vscodelang.FoldingRange;
}
export class MethodDeclarationSymbol
    extends MethodSymbol
    implements IKindSymbol
{
    public get kind() {
        return SymbolKind.MethodDeclaration;
    }
}
export class InlineClosureSymbol extends MethodSymbol implements IKindSymbol {
    public get kind() {
        return SymbolKind.InlineClosure;
    }
}
export class ArgumentSymbol extends TypedSymbol implements IKindSymbol {
    public get kind() {
        return SymbolKind.Variable;
    }
}

export class ExpressionSymbol extends ScopedSymbol {}
export class FunctionIdentifierSymbol
    extends ScopedSymbol
    implements IKindSymbol
{
    public get kind() {
        return SymbolKind.Keyword;
    }
}

export class ObjectSymbol extends ScopedSymbol {
    public isLoaded: boolean = false;

    constructor(
        name: string,
        public filename: string,
        public type: ObjectType
    ) {
        super(name);
    }
}

export class OperatorSymbol extends LpcBaseSymbol {
    public get kind() {
        return SymbolKind.Operator;
    }
}

export class BlockSymbol extends ScopedSymbol {}
export class LiteralSymbol
    extends TypedSymbol
    implements IEvaluatableSymbol, IKindSymbol
{
    public get kind() {
        return SymbolKind.Literal;
    }

    constructor(name: string, type: IType, public value: any) {
        super(name, type);
    }

    eval(scope: EvalScope) {
        return this.value;
    }
}

export class EfunSymbol extends BaseMethodSymbol implements IKindSymbol {
    public constructor(name: string, public returnType?: IType) {
        super(name);
    }
    public get kind() {
        return SymbolKind.Efun;
    }
    public getParametersSync() {
        return getSymbolsOfTypeSync(this, ParameterSymbol);
    }
}

export class PreprocessorSymbol extends ScopedSymbol {
    constructor(name: string, public label: string) {
        super(name);
    }
}

/** if, switch, etc */
export class SelectionSymbol extends ScopedSymbol implements IFoldableSymbol {
    constructor(
        name: string,
        public label: string,
        public foldingRange: vscodelang.FoldingRange
    ) {
        super(name);
    }
}

export class IfSymbol extends ScopedSymbol {
    public if: SelectionSymbol;
    public elseIf: SelectionSymbol[];
    public else: SelectionSymbol;

    constructor(name: string) {
        super(name);
    }
}

const symbolDescriptionMap = new Map<SymbolKind, string>([
    [SymbolKind.Terminal, "Terminal"],
    [SymbolKind.Keyword, "Keyword"],
    [SymbolKind.Include, "Include"],
    [SymbolKind.Method, "Method"],
    [SymbolKind.MethodDeclaration, "Method Declaration"],
    [SymbolKind.Variable, "Variable"],
    [SymbolKind.Define, "Define"],
    [SymbolKind.Inherit, "Inherit"],
    [SymbolKind.InlineClosure, "Inline Closure Callback"],
    [SymbolKind.Efun, "Efun"],
]);

const symbolCodeTypeMap = new Map<SymbolKind, vscodelang.SymbolKind>([
    [SymbolKind.Terminal, vscodelang.SymbolKind.EnumMember],
    [SymbolKind.Keyword, vscodelang.SymbolKind.Key],
    [SymbolKind.Include, vscodelang.SymbolKind.Module],
    [SymbolKind.Inherit, vscodelang.SymbolKind.Module],
    [SymbolKind.Method, vscodelang.SymbolKind.Method],
    [SymbolKind.MethodDeclaration, vscodelang.SymbolKind.Interface],
    [SymbolKind.InlineClosure, vscodelang.SymbolKind.Method],
    [SymbolKind.Variable, vscodelang.SymbolKind.Variable],
    [SymbolKind.Define, vscodelang.SymbolKind.Constant],
]);

/**
 * Provides a textual expression for a native symbol kind.
 *
 * @param kind The kind of symbol for which a description is needed.
 *
 * @returns The description.
 */
export const symbolDescriptionFromEnum = (kind: SymbolKind): string => {
    return symbolDescriptionMap.get(kind) || "Unknown";
};

/**
 * Converts the native symbol kind to a vscode symbol kind.
 *
 * @param kind The kind of symbol for which the vscode kind is needed.
 *
 * @returns The vscode symbol kind for the given ANTLR4 kind.
 */
export const translateSymbolKind = (
    kind: SymbolKind
): vscodelang.SymbolKind => {
    return symbolCodeTypeMap.get(kind) || vscodelang.SymbolKind.Null;
};

const symbolCompletionTypeMap = new Map<
    SymbolKind,
    vscodelang.CompletionItemKind
>([
    [SymbolKind.Terminal, vscodelang.CompletionItemKind.EnumMember],
    [SymbolKind.Keyword, vscodelang.CompletionItemKind.Keyword],
    [SymbolKind.Block, vscodelang.CompletionItemKind.Function],
    [SymbolKind.Define, vscodelang.CompletionItemKind.Variable],
    [SymbolKind.Inherit, vscodelang.CompletionItemKind.Function],
    [SymbolKind.Method, vscodelang.CompletionItemKind.Function],
    [SymbolKind.Variable, vscodelang.CompletionItemKind.Variable],
    [SymbolKind.Operator, vscodelang.CompletionItemKind.Operator],
    [SymbolKind.Efun, vscodelang.CompletionItemKind.Function],
]);

/**
 * Converts the native symbol kind to a vscode completion item kind.
 *
 * @param kind The kind of symbol for which return the completion item kind.
 *
 * @returns The vscode completion item kind.
 */
export const translateCompletionKind = (
    kind: SymbolKind
): vscodelang.CompletionItemKind => {
    return (
        symbolCompletionTypeMap.get(kind) || vscodelang.CompletionItemKind.Text
    );
};

/** Determines the sort order in the completion list. One value for each SymbolKind. */

export const completionSortKeys = new Map<SymbolKind, string>([
    [SymbolKind.Keyword, "01"],
    [SymbolKind.Method, "08"],
    [SymbolKind.Variable, "05"],
    [SymbolKind.Efun, "02"],
    [SymbolKind.Operator, "00"],
]);

// Descriptions for each symbol kind.

export const completionDetails = new Map<SymbolKind, string>([
    [SymbolKind.Keyword, "Keyword"],
    [SymbolKind.Operator, "Operator"],
    [SymbolKind.Efun, "Driver efun"],
    [SymbolKind.Variable, "Variable"],
    [SymbolKind.Method, "Method"],
]);

export class ITypedSymbol {
    type: IType;
}

export class ObjectType extends BaseSymbol implements IType {
    public constructor(public name: string) {
        super(name);
    }

    baseTypes: IType[] = [];

    public get kind(): TypeKind {
        return TypeKind.Class;
    }

    public get reference(): ReferenceKind {
        return ReferenceKind.Instance;
    }
}
