/*
 * Copyright (c) 2024-2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Scene } from '../../Scene';
import { DataflowProblem, FlowFunction } from './DataflowProblem';
import { Local } from '../base/Local';
import { Value } from '../base/Value';
import { ClassType, UndefinedType } from '../base/Type';
import { ArkAssignStmt, ArkInvokeStmt, Stmt } from '../base/Stmt';
import { ArkMethod } from '../model/ArkMethod';
import { Constant } from '../base/Constant';
import { AbstractRef, ArkInstanceFieldRef, ArkStaticFieldRef } from '../base/Ref';
import { DataflowSolver } from './DataflowSolver';
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from '../base/Expr';
import { FileSignature, NamespaceSignature } from '../model/ArkSignature';
import { ArkClass } from '../model/ArkClass';
import { LocalEqual, RefEqual } from './Util';
import { INSTANCE_INIT_METHOD_NAME, STATIC_INIT_METHOD_NAME } from '../common/Const';
import { ArkField } from '../model/ArkField';
import Logger, { LOG_MODULE_TYPE } from '../../utils/logger';
import * as fs from 'fs';
import { PathEdge } from './Edge';

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'Scene');

export class UndefinedVariableChecker extends DataflowProblem<Value> {
    zeroValue: Constant = new Constant('undefined', UndefinedType.getInstance());
    entryPoint: Stmt;
    entryMethod: ArkMethod;
    scene: Scene;
    classMap: Map<FileSignature | NamespaceSignature, ArkClass[]>;
    globalVariableMap: Map<FileSignature | NamespaceSignature, Local[]>;
    outcomes: Outcome[] = [];
    constructor(stmt: Stmt, method: ArkMethod) {
        super();
        this.entryPoint = stmt;
        this.entryMethod = method;
        this.scene = method.getDeclaringArkFile().getScene();
        this.classMap = this.scene.getClassMap();
        this.globalVariableMap = this.scene.getGlobalVariableMap();
    }

    getEntryPoint(): Stmt {
        return this.entryPoint;
    }

    getEntryMethod(): ArkMethod {
        return this.entryMethod;
    }

    private isUndefined(val: Value): boolean {
        if (val instanceof Constant) {
            let constant: Constant = val as Constant;
            if (constant.getType() instanceof UndefinedType) {
                return true;
            }
        }
        return false;
    }

    getNormalFlowFunction(srcStmt: Stmt, tgtStmt: Stmt): FlowFunction<Value> {
        let checkerInstance: UndefinedVariableChecker = this;
        return new (class implements FlowFunction<Value> {
            getDataFacts(dataFact: Value): Set<Value> {
                let ret: Set<Value> = new Set();
                if (checkerInstance.getEntryPoint() === srcStmt && checkerInstance.getZeroValue() === dataFact) {
                    ret.add(checkerInstance.getZeroValue());
                    return ret;
                }
                if (srcStmt instanceof ArkAssignStmt) {
                    checkerInstance.insideNormalFlowFunction(ret, srcStmt, dataFact);
                }
                // newly added
                // handle library API invocation cases where datafacts should be retained directly
                if (srcStmt instanceof ArkInvokeStmt){
                    ret.add(dataFact);
                }
                return ret;
            }
        })();
    }

    insideNormalFlowFunction(ret: Set<Value>, srcStmt: ArkAssignStmt, dataFact: Value): void {
        if (!this.factEqual(srcStmt.getDef()!, dataFact)) {
            if (!(dataFact instanceof Local && dataFact.getName() === srcStmt.getDef()!.toString())) {
                ret.add(dataFact);
            }
        }
        let ass: ArkAssignStmt = srcStmt as ArkAssignStmt;
        let assigned: Value = ass.getLeftOp();
        let rightOp: Value = ass.getRightOp();
        // to be revised
        if (this.getZeroValue() === dataFact) {
            if (this.isUndefined(rightOp)) {
                ret.add(assigned);
            }
        } else if (this.factEqual(rightOp, dataFact) || rightOp.getType() instanceof UndefinedType) {
            ret.add(assigned);
        } else if (rightOp instanceof ArkInstanceFieldRef) {
            const base = rightOp.getBase();
            if (base === dataFact || (!base.getDeclaringStmt() && base.getName() === dataFact.toString())) {
                this.outcomes.push(new Outcome(rightOp, ass));
                logger.info('undefined base');
                logger.info(srcStmt.toString());
                logger.info(srcStmt.getOriginPositionInfo().toString());
            }
        } else if (dataFact instanceof ArkInstanceFieldRef && rightOp === dataFact.getBase()) {
            const field = new ArkInstanceFieldRef(srcStmt.getLeftOp() as Local, dataFact.getFieldSignature());
            ret.add(field);
        }
    }

    getCallFlowFunction(srcStmt: Stmt, method: ArkMethod): FlowFunction<Value> {
        let checkerInstance: UndefinedVariableChecker = this;
        return new (class implements FlowFunction<Value> {
            getDataFacts(dataFact: Value): Set<Value> {
                const ret: Set<Value> = new Set();
                if (checkerInstance.getZeroValue() === dataFact) {
                    checkerInstance.insideCallFlowFunction(ret, method);
                } else {
                    const callExpr = srcStmt.getExprs()[0];
                    if (
                        callExpr instanceof ArkInstanceInvokeExpr &&
                        dataFact instanceof ArkInstanceFieldRef &&
                        callExpr.getBase().getName() === dataFact.getBase().getName()
                    ) {
                        // todo:base转this
                        const thisRef = new ArkInstanceFieldRef(
                            new Local('this', new ClassType(method.getDeclaringArkClass().getSignature())),
                            dataFact.getFieldSignature()
                        );
                        ret.add(thisRef);
                    } else if (
                        callExpr instanceof ArkStaticInvokeExpr &&
                        dataFact instanceof ArkStaticFieldRef &&
                        callExpr.getMethodSignature().getDeclaringClassSignature() === dataFact.getFieldSignature().getDeclaringSignature()
                    ) {
                        ret.add(dataFact);
                    }
                }
                checkerInstance.addParameters(srcStmt, dataFact, method, ret);
                return ret;
            }
        })();
    }

    insideCallFlowFunction(ret: Set<Value>, method: ArkMethod): void {
        ret.add(this.getZeroValue());
        // 加上调用函数能访问到的所有静态变量，如果不考虑多线程，加上所有变量，考虑则要统计之前已经处理过的变量并排除
        for (const field of method.getDeclaringArkClass().getStaticFields(this.classMap)) {
            if (field.getInitializer() === undefined) {
                ret.add(new ArkStaticFieldRef(field.getSignature()));
            }
        }
        for (const local of method.getDeclaringArkClass().getGlobalVariable(this.globalVariableMap)) {
            ret.add(local);
        }
        // 加上所有未定义初始值的属性
        if (method.getName() === INSTANCE_INIT_METHOD_NAME || method.getName() === STATIC_INIT_METHOD_NAME) {
            for (const field of method.getDeclaringArkClass().getFields()) {
                this.addUndefinedField(field, method, ret);
            }
        }
    }

    addUndefinedField(field: ArkField, method: ArkMethod, ret: Set<Value>): void {
        let defined = false;
        for (const stmt of method.getCfg()!.getStmts()) {
            const def = stmt.getDef();
            if (def instanceof ArkInstanceFieldRef && def.getFieldSignature() === field.getSignature()) {
                defined = true;
                break;
            }
        }
        if (!defined) {
            const fieldRef = new ArkInstanceFieldRef(new Local('this', new ClassType(method.getDeclaringArkClass().getSignature())), field.getSignature());
            ret.add(fieldRef);
        }
    }

    addParameters(srcStmt: Stmt, dataFact: Value, method: ArkMethod, ret: Set<Value>): void {
        const callStmt = srcStmt as ArkInvokeStmt;
        const args = callStmt.getInvokeExpr().getArgs();
        for (let i = 0; i < args.length; i++) {
            if (args[i] === dataFact || (this.isUndefined(args[i]) && this.getZeroValue() === dataFact)) {
                const realParameter = method.getCfg()!.getStartingBlock()!.getStmts()[i].getDef();
                if (realParameter) {
                    ret.add(realParameter);
                }
            } else if (dataFact instanceof ArkInstanceFieldRef && dataFact.getBase().getName() === args[i].toString()) {
                const realParameter = method.getCfg()!.getStartingBlock()!.getStmts()[i].getDef();
                if (realParameter) {
                    const retRef = new ArkInstanceFieldRef(realParameter as Local, dataFact.getFieldSignature());
                    ret.add(retRef);
                }
            }
        }
    }

    getExitToReturnFlowFunction(srcStmt: Stmt, tgtStmt: Stmt, callStmt: Stmt): FlowFunction<Value> {
        let checkerInstance: UndefinedVariableChecker = this;
        return new (class implements FlowFunction<Value> {
            getDataFacts(dataFact: Value): Set<Value> {
                let ret: Set<Value> = new Set<Value>();
                if (dataFact === checkerInstance.getZeroValue()) {
                    ret.add(checkerInstance.getZeroValue());
                }
                return ret;
            }
        })();
    }

    getCallToReturnFlowFunction(srcStmt: Stmt, tgtStmt: Stmt): FlowFunction<Value> {
        let checkerInstance: UndefinedVariableChecker = this;
        return new (class implements FlowFunction<Value> {
            getDataFacts(dataFact: Value): Set<Value> {
                const ret: Set<Value> = new Set();
                if (checkerInstance.getZeroValue() === dataFact) {
                    ret.add(checkerInstance.getZeroValue());
                }
                const defValue = srcStmt.getDef();
                if (!(defValue && defValue === dataFact)) {
                    ret.add(dataFact);
                }
                return ret;
            }
        })();
    }

    createZeroValue(): Value {
        return this.zeroValue;
    }

    getZeroValue(): Value {
        return this.zeroValue;
    }

    factEqual(d1: Value, d2: Value): boolean {
        if (d1 instanceof Constant && d2 instanceof Constant) {
            return d1 === d2;
        } else if (d1 instanceof Local && d2 instanceof Local) {
            return LocalEqual(d1, d2);
        } else if (d1 instanceof AbstractRef && d2 instanceof AbstractRef) {
            return RefEqual(d1, d2);
        }
        return false;
    }

    public getOutcomes(): Outcome[] {
        return this.outcomes;
    }
}

export class UndefinedVariableSolver extends DataflowSolver<Value> {
    constructor(problem: UndefinedVariableChecker, scene: Scene) {
        super(problem, scene);
    }

    public toResult() {
        // print pathedge results
        for (const pathEdge of this.pathEdgeSet) {
            console.log("[node: " + pathEdge.edgeStart.node + ", fact: " + pathEdge.edgeStart.fact + "]  ----->  [node:" + pathEdge.edgeEnd.node + ", fact: " + pathEdge.edgeEnd.fact + "]\n");
        }
        const reports = this.extractNPDReports(this.pathEdgeSet);
        reports.exportJSONToFile('./output/report.json');
    }

    protected extractNPDReports(edges: Set<PathEdge<Value>>): ViolationReportManager {    
        const reportManager = new ViolationReportManager();
        const pathsByFact = new Map<Value, PathEdge<Value>[]>();
    
        for (const edge of edges) {
            const fact = edge.edgeEnd.fact;
            if (!pathsByFact.has(fact)) {
                pathsByFact.set(fact, []);
            }
            pathsByFact.get(fact)!.push(edge);
        }
    
        for (const [fact, path] of pathsByFact.entries()) {
            if (fact === this.zeroFact)
                continue;
            for (const edge of path) {
                const stmt = edge.edgeEnd.node;
                if (this.isNullPointerDereferenceTriggered(stmt, fact)) {
                    const report = new ViolationReport(fact, edge.edgeEnd.node, `Variable '${fact}' used before being defined (undefined)`);
                    // TODO: complement the def-use chain searching
                    if (fact instanceof Local) {
                        let def = fact.getDeclaringStmt()
                        if (def !== null) {
                            report.addPathPoint(def);
                        }
                        for (let use of fact.getUsedStmts()){
                            report.addPathPoint(use);
                        }
                    }
                    reportManager.addReport(report);
                    break; 
                }
            }
        }
        return reportManager;
    }

    protected isNullPointerDereferenceTriggered(stmt: Stmt, fact: Value): boolean {
        let triggered = false;
        // stmt has invocation expr && input fact the same as the base local
        if (stmt.containsInvokeExpr()) {
            const invokeExpr = stmt.getInvokeExpr();
            if (invokeExpr) {
                // ArkStaticInvokeExpr, ArkInstanceInvokeExpr, or ArkPtrInvokeExpr
                if (invokeExpr instanceof ArkInstanceInvokeExpr) {
                    const base = invokeExpr.getBase();
                    if (this.problem.factEqual(base, fact)) {
                        triggered = true;
                    }
                }
            }
        }
        return triggered;
    }
}

// newly added
// build the Report class to record NPD information and paths
export class ViolationReport {
    fact: Value;
    node: Stmt;
    reason: string;
    path: Stmt[];

    constructor(fact: Value, node: Stmt, reason: string) {
        this.fact = fact;
        this.node = node;
        this.reason = reason;
        this.path = [];
    }

    addPathPoint(edge: Stmt) {
        this.path.push(edge);
    }

    toJSON(): object {
        return {
            fact: (this.fact instanceof Local) ? this.fact.getName() : this.fact.getType(),
            node: this.node.toString(),
            reason: this.reason,
            path: this.path.map((stmt, index) => ({
                step: index + 1,
                stmt: stmt.toString(),
                method: stmt.getCfg().getDeclaringMethod().getSignature()
            }))
        };
    }
}

export class ViolationReportManager {
    reports: ViolationReport[] = [];

    addReport(report: ViolationReport) {
        this.reports.push(report);
    }

    exportAsJSON(): string {
        return JSON.stringify(this.reports.map(r => r.toJSON()), null, 2);
    }

    exportJSONToFile(filename: string) {
        const json = JSON.stringify(this.reports.map(r => r.toJSON()), null, 2);
        fs.writeFileSync(filename, json, 'utf-8');
        console.log(`JSON file has been outputed to dir: ${filename}`);
    }
}

class Outcome {
    value: Value;
    stmt: Stmt;
    constructor(v: Value, s: Stmt) {
        this.value = v;
        this.stmt = s;
    }
}
