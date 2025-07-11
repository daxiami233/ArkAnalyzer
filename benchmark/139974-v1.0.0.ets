/* TEMPLATE GENERATED TESTCASE FILE
Filename: CWE476_NULL_Pointer_Dereference__deref_after_check_13.java
Label Definition File: CWE476_NULL_Pointer_Dereference.pointflaw.label.xml
Template File: point-flaw-13.tmpl.java
*/
/*
* @description
* CWE: 476 NULL Pointer Dereference
* Sinks: deref_after_check
*    GoodSink: Do not dereference an object if it is null
*    BadSink : Dereference after checking to see if an object is null
* Flow Variant: 13 Control flow: if(IO.STATIC_FINAL_FIVE==5) and if(IO.STATIC_FINAL_FIVE!=5)
*
* */

import { IO, AbstractTestCase } from './testcasesupport';

export class CWE476_NULL_Pointer_Dereference__deref_after_check_13 extends AbstractTestCase {
    public bad(): void {
        if (IO.STATIC_FINAL_FIVE === 5) {
            {
                /* FLAW: Check for null, but still dereference the object */
                let myString: string | null = null;
                if (myString === null) {
                    // In ArkTS, string.length is a property. Accessing it on a null\n                    // reference will cause a runtime error, replicating the Java bug.
                    IO.writeLine(myString.length); // Replicates the null pointer dereference
                }
            }
        }
    }

    /* good1() changes IO.STATIC_FINAL_FIVE==5 to IO.STATIC_FINAL_FIVE!=5 */
    private good1(): void {
        if (IO.STATIC_FINAL_FIVE !== 5) {
            /* INCIDENTAL: CWE 561 Dead Code, the code below will never run */
            IO.writeLine("Benign, fixed string");
        }
        else {
            {
                /* FIX: Check for null and do not dereference the object if it is null */
                let myString: string | null = null;
                if (myString === null) {
                    IO.writeLine("The string is null");
                }
            }
        }
    }

    /* good2() reverses the bodies in the if statement */
    private good2(): void {
        if (IO.STATIC_FINAL_FIVE === 5) {
            {
                /* FIX: Check for null and do not dereference the object if it is null */
                let myString: string | null = null;
                if (myString === null) {
                    IO.writeLine("The string is null");
                }
            }
        }
    }

    public good(): void {
        this.good1();
        this.good2();
    }

    /* Below is the main(). It is only used when building this testcase on
     * its own for testing or for building a binary to use in testing binary
     * analysis tools. It is not used when compiling all the testcases as one
     * application, which is how source code analysis tools are tested.
     */
    public static main(args: string[]): void {
        AbstractTestCase.mainFromParent(args);
    }
}