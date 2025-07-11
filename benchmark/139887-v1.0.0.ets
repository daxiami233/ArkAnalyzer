/* TEMPLATE GENERATED TESTCASE FILE
Filename: CWE476_NULL_Pointer_Dereference__StringBuilder_17.java
Label Definition File: CWE476_NULL_Pointer_Dereference.label.xml
Template File: sources-sinks-17.tmpl.java
*/
/*
* @description
* CWE: 476 Null Pointer Dereference
* BadSource:  Set data to null
* GoodSource: Set data to a non-null value
* Sinks:
*    GoodSink: add check to prevent possibility of null dereference
*    BadSink : possibility of null dereference
* Flow Variant: 17 Control flow: for loops
*
* */

import { IO, AbstractTestCase, AbstractTestCaseBase } from './testcasesupport';

export class CWE476_NULL_Pointer_Dereference__StringBuilder_17 extends AbstractTestCase {
    public bad(): void {
        let data: string | null;

        // To ensure the variable is declared and explicitly set before its use in the loop, replicating the original structure.

        /* POTENTIAL FLAW: data is null */
        data = null;

        for (let j = 0; j < 1; j++) {
            /* POTENTIAL FLAW: null dereference will occur if data is null */
            IO.writeLine("" + data!.length);
        }
    }

    /* goodG2B() - use goodsource and badsink */
    private goodG2B(): void {
        let data: string | null;

        /* FIX: hardcode data to non-null */
        data = ""; // Equivalent to new StringBuilder() in terms of initial state

        for (let j = 0; j < 1; j++) {
            /* POTENTIAL FLAW: null dereference will occur if data is null */
            IO.writeLine("" + data!.length);
        }
    }

    /* goodB2G() - use badsource and goodsink*/
    private goodB2G(): void {
        let data: string | null;

        /* POTENTIAL FLAW: data is null */
        data = null;

        for (let k = 0; k < 1; k++) {
            /* FIX: validate that data is non-null */
            if (data != null) {
                IO.writeLine("" + data.length);
            } else {
                IO.writeLine("data is null");
            }
        }
    }

    public good(): void {
        this.goodG2B();
        this.goodB2G();
    }

    /* Below is the main(). It is only used when building this testcase on
     * its own for testing or for building a binary to use in testing binary
     * analysis tools. It is not used when compiling all the testcases as one
     * application, which is how source code analysis tools are tested.
     */
    public static main(...args: string[]): void {
        AbstractTestCase.mainFromParent(args);
    }
}