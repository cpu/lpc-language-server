import { IEvaluatableSymbol } from "./base";
import { CallStack, StackFrame, StackValue } from "../backend/CallStack";
import { MethodInvocationSymbol } from "./methodSymbol";
import { ObjectReferenceInfo } from "./objectSymbol";
import { SourceContext } from "../backend/SourceContext";
import { ParserRuleContext } from "antlr4ng";
import { ContextSymbolTable } from "../backend/ContextSymbolTable";
import { normalizeFilename, rangeFromTokens } from "../utils";
import { DiagnosticSeverity } from "vscode-languageserver";
import { addDiagnostic } from "./Symbol";
import { ScopedSymbol } from "antlr4-c3";

export enum ArrowType {
    CallOther,
    StructMember,
}

/**
 * An arrow symbol can be a Call Other (i.e. `obj->fn()`) or a struct member access (`foo->member`).
 * The specific type may be determined if by syntax (if there are parens, indicated a method invocation),
 * but otherwise can't be determined until eval-time based on the resulting type of the source object.
 */
export class ArrowSymbol extends ScopedSymbol implements IEvaluatableSymbol {
    public ArrowType: ArrowType = ArrowType.CallOther;

    /** the object that call_other will be invoked on */
    public source: IEvaluatableSymbol;

    /** the target method/member that will be invoked/access on `source` */
    public target: IEvaluatableSymbol;

    /** the method invocation symbol, which contains arguments for a call other  */
    public methodInvocation: MethodInvocationSymbol;

    public functionName?: string;

    /** information about the object (not the symbol) that call_other is being invoked on */
    public objectRef: ObjectReferenceInfo;
    public objContext: SourceContext;

    eval(stack: CallStack, scope?: any) {
        const srcValue = this.source.eval(stack) as StackValue;

        // only evaluate as a struct if the source object is
        // specifically known to be a struct
        if (srcValue?.type?.name == "struct") {
            this.ArrowType = ArrowType.StructMember;
            return this.evalStruct(stack, scope, srcValue);
        } else {
            this.ArrowType = ArrowType.CallOther;
            return this.evalCallOther(stack, scope, srcValue);
        }
    }

    private evalStruct(stack: CallStack, scope: any, srcValue: StackValue) {
        if (!this.target) {
            const ctx = this.context as ParserRuleContext;
            addDiagnostic(this, {
                message: `Missing struct access member name `,
                range: rangeFromTokens(ctx.start, ctx.stop),
                type: DiagnosticSeverity.Error,
            });
        } else if (this.methodInvocation) {
            const ctx = this.target.context as ParserRuleContext;
            addDiagnostic(this, {
                message: `Cannot call methods on struct members`,
                range: rangeFromTokens(ctx.start, ctx.stop),
                type: DiagnosticSeverity.Error,
            });
        }

        // NTBLA: Eval struct member access here

        return scope;
    }

    private evalCallOther(stack: CallStack, scope: any, srcValue: StackValue) {
        // run some diagnostics
        if (!this.target) {
            const ctx = this.context as ParserRuleContext;
            (this.symbolTable as ContextSymbolTable).owner.addDiagnostic({
                message: `Missing method name`,
                range: rangeFromTokens(ctx.start, ctx.stop),
                type: DiagnosticSeverity.Error,
            });
        } else if (!this.methodInvocation) {
            const ctx = this.target.context as ParserRuleContext;
            addDiagnostic(this, {
                message: `Missing ()`,
                range: rangeFromTokens(ctx.start, ctx.stop),
                type: DiagnosticSeverity.Error,
            });
        }

        // even if diagnostics failed, continue evaluating because
        // we may have an objContext that we want to return
        const obj = srcValue?.value;
        if (typeof obj === "string") {
            // try to load the object
            this.objContext = this.loadObject(obj);
        } else if (obj instanceof ObjectReferenceInfo) {
            this.objectRef = obj;
            this.objContext = obj.context;
        } else {
            // TODO report this as a diagnostic?
            console.debug("expected object reference info", obj);
            return undefined;
        }

        // function name could be an expression, so evaluate that
        if (!this.functionName || this.functionName == "#fn") {
            this.functionName = this.target?.eval(stack);
        }

        if (!this.functionName) {
            // TODO send via diagnostic?
            console.warn(
                "could not determine function name for arrow: " + this.name
            );
        }

        // at this point we've figured out the function name and now need
        // to find the actual function symbol which will be in the source
        // object's symbol table
        const symTbl = this.objContext?.symbolTable; // (obj as ObjectReferenceInfo).context?.symbolTable;
        const funSym = symTbl?.getFunction(this.functionName);

        if (!funSym) {
            const ctx = (this.target ?? this).context as ParserRuleContext;
            addDiagnostic(this, {
                message: `Function '${
                    this.functionName ?? ""
                }' may be undefined`,
                range: rangeFromTokens(ctx.start, ctx.stop),
                type: DiagnosticSeverity.Error,
            });
            return undefined;
        }

        // the method invocation symbol will have the call arguments
        const methodInvok = this.methodInvocation;
        if (!(methodInvok instanceof MethodInvocationSymbol))
            console.warn("expected a method invocation", this.name);

        // evaluate the argumnents
        const argVals = methodInvok?.getArguments().map((a) => a.eval(stack));

        // create a new root frame for this object
        // this doesn't need to go on the stack, it's just a temporary frame
        const rootFrame = new StackFrame(
            symTbl,
            new Map<string, any>(),
            new Map<string, any>()
        );
        const stackFrame = new StackFrame(
            funSym,
            new Map<string, any>(),
            new Map<string, any>(),
            rootFrame
        );
        stack.push(stackFrame);

        const result = funSym.eval(stack, argVals);

        stack.pop();
        return result;
    }

    loadObject(filename: string) {
        const ownerContext = (this.symbolTable as ContextSymbolTable).owner;
        const backend = ownerContext.backend;
        const sourceContext = backend.loadLpc(
            normalizeFilename(backend.filenameToAbsolutePath(filename))
        );
        if (!sourceContext) {
            const ctx = this.context as ParserRuleContext;
            addDiagnostic(this, {
                message: "could not load source for: " + filename,
                range: rangeFromTokens(ctx.start, ctx.stop),
                type: DiagnosticSeverity.Warning,
            });
        } else {
            ownerContext.addAsReferenceTo(sourceContext);
        }
        return sourceContext;
    }
}
