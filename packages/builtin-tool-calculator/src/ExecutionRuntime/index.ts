import { type BuiltinServerRuntimeOutput } from '@lobechat/types';

import { calculatorExecutor } from '../executor';
import {
  type BaseParams,
  type BaseState,
  type CalculateParams,
  type CalculateState,
  type DefintegrateParams,
  type DefintegrateState,
  type DifferentiateParams,
  type DifferentiateState,
  type EvaluateParams,
  type EvaluateState,
  type ExecuteParams,
  type ExecuteState,
  type IntegrateParams,
  type IntegrateState,
  type LimitParams,
  type LimitState,
  type SolveParams,
  type SolveState,
  type SortParams,
  type SortState,
} from '../types';

/**
 * Calculator Execution Runtime
 *
 * This runtime executes calculator tools using the same executor logic as frontend.
 * Since mathjs and nerdamer work in both browser and Node.js, we can reuse the executor.
 */
export class CalculatorExecutionRuntime {
  async calculate(args: CalculateParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.calculate(args);
      const resultState = result.state as CalculateState | undefined;

      const state: CalculateState = {
        expression: resultState?.expression,
        precision: resultState?.precision,
        result: resultState?.result,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async evaluate(args: EvaluateParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.evaluate(args);
      const resultState = result.state as EvaluateState | undefined;

      const state: EvaluateState = {
        expression: resultState?.expression,
        precision: resultState?.precision,
        result: resultState?.result,
        variables: resultState?.variables,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async sort(args: SortParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.sort(args);
      const resultState = result.state as SortState | undefined;

      const state: SortState = {
        largest: resultState?.largest,
        mode: resultState?.mode,
        originalNumbers: resultState?.originalNumbers,
        precision: resultState?.precision,
        result: resultState?.result,
        reverse: resultState?.reverse,
        smallest: resultState?.smallest,
        sorted: resultState?.sorted,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async base(args: BaseParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.base(args);
      const resultState = result.state as BaseState | undefined;

      const state: BaseState = {
        convertedNumber: resultState?.convertedNumber,
        decimalValue: resultState?.decimalValue,
        originalBase: resultState?.originalBase,
        originalNumber: resultState?.originalNumber,
        targetBase: resultState?.targetBase,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async solve(args: SolveParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.solve(args);
      const resultState = result.state as SolveState | undefined;

      const state: SolveState = {
        equation: resultState?.equation,
        result: resultState?.result,
        variable: resultState?.variable,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async differentiate(args: DifferentiateParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.differentiate(args);
      const resultState = result.state as DifferentiateState | undefined;

      const state: DifferentiateState = {
        expression: resultState?.expression,
        result: resultState?.result,
        variable: resultState?.variable,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async execute(args: ExecuteParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.execute(args);
      const resultState = result.state as ExecuteState | undefined;

      const state: ExecuteState = {
        expression: resultState?.expression,
        result: resultState?.result,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async defintegrate(args: DefintegrateParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.defintegrate(args);
      const resultState = result.state as DefintegrateState | undefined;

      const state: DefintegrateState = {
        expression: resultState?.expression,
        lowerBound: resultState?.lowerBound,
        result: resultState?.result,
        upperBound: resultState?.upperBound,
        variable: resultState?.variable,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async integrate(args: IntegrateParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.integrate(args);
      const resultState = result.state as IntegrateState | undefined;

      const state: IntegrateState = {
        expression: resultState?.expression,
        result: resultState?.result,
        variable: resultState?.variable,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }

  async limit(args: LimitParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await calculatorExecutor.limit(args);
      const resultState = result.state as LimitState | undefined;

      const state: LimitState = {
        expression: resultState?.expression,
        point: resultState?.point,
        result: resultState?.result,
        variable: resultState?.variable,
      };

      return {
        content: result.content || '',
        state,
        success: result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: errorMessage,
        error,
        success: false,
      };
    }
  }
}
