/**
 * Interactive prompt utilities
 *
 * Uses the "prompts" package for user interaction
 * @see /docs/specs/cli.md
 */
import prompts, { type Choice, type PromptObject } from "prompts";

/**
 * Prompt cancellation error
 */
export class PromptCancelledError extends Error {
  constructor() {
    super("Prompt cancelled by user");
    this.name = "PromptCancelledError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Handle cancelled prompts
 */
function onCancel(): void {
  throw new PromptCancelledError();
}

/**
 * Check if a value is the cancellation signal
 */
function isCancelled(response: Record<string, unknown>): boolean {
  return Object.keys(response).length === 0;
}

/**
 * Confirm prompt options
 */
export interface ConfirmOptions {
  /** Initial value */
  initial?: boolean;
  /** Disable prompt and return initial */
  skip?: boolean;
}

/**
 * Confirm prompt - yes/no question
 *
 * @param message - Question to ask
 * @param options - Prompt options
 * @returns User's confirmation
 * @throws PromptCancelledError if user cancels
 */
export async function confirm(
  message: string,
  options: ConfirmOptions = {}
): Promise<boolean> {
  if (options.skip) {
    return options.initial ?? false;
  }

  const response = await prompts(
    {
      type: "confirm",
      name: "value",
      message,
      initial: options.initial ?? false,
    },
    { onCancel }
  );

  if (isCancelled(response)) {
    throw new PromptCancelledError();
  }

  return response.value === true;
}

/**
 * Select option choice
 */
export interface SelectChoice<T> {
  /** Display title */
  title: string;
  /** Value to return when selected */
  value: T;
  /** Optional description */
  description?: string;
  /** Disable this option */
  disabled?: boolean;
}

/**
 * Select prompt options
 */
export interface SelectOptions {
  /** Initial value index */
  initial?: number;
  /** Hint text */
  hint?: string;
  /** Disable prompt and return initial selection */
  skip?: boolean;
}

/**
 * Select prompt - single selection from choices
 *
 * @param message - Question to ask
 * @param choices - Available choices
 * @param options - Prompt options
 * @returns Selected value
 * @throws PromptCancelledError if user cancels
 */
export async function select<T>(
  message: string,
  choices: SelectChoice<T>[],
  options: SelectOptions = {}
): Promise<T> {
  if (options.skip && options.initial !== undefined) {
    const choice = choices[options.initial];
    if (choice) {
      return choice.value;
    }
  }

  const promptChoices: Choice[] = choices.map((choice) => ({
    title: choice.title,
    value: choice.value,
    description: choice.description,
    disabled: choice.disabled,
  }));

  const response = await prompts(
    {
      type: "select",
      name: "value",
      message,
      choices: promptChoices,
      initial: options.initial ?? 0,
      hint: options.hint,
    },
    { onCancel }
  );

  if (isCancelled(response)) {
    throw new PromptCancelledError();
  }

  return response.value;
}

/**
 * Input prompt options
 */
export interface InputOptions {
  /** Initial value */
  initial?: string;
  /** Validation function */
  validate?: (value: string) => boolean | string;
  /** Hint text */
  hint?: string;
  /** Disable prompt and return initial */
  skip?: boolean;
}

/**
 * Input prompt - text input
 *
 * @param message - Question to ask
 * @param options - Prompt options
 * @returns User's input
 * @throws PromptCancelledError if user cancels
 */
export async function input(
  message: string,
  options: InputOptions = {}
): Promise<string> {
  if (options.skip) {
    return options.initial ?? "";
  }

  const promptObj: PromptObject = {
    type: "text",
    name: "value",
    message,
    initial: options.initial,
  };

  if (options.validate) {
    promptObj.validate = (value: string) => {
      const result = options.validate?.(value);
      if (result === true || result === undefined) {
        return true;
      }
      if (result === false) {
        return "Invalid input";
      }
      return result;
    };
  }

  const response = await prompts(promptObj, { onCancel });

  if (isCancelled(response)) {
    throw new PromptCancelledError();
  }

  return response.value ?? "";
}

/**
 * Password prompt options
 */
export interface PasswordOptions {
  /** Validation function */
  validate?: (value: string) => boolean | string;
  /** Confirmation prompt (ask twice) */
  confirm?: boolean;
  /** Hint text */
  hint?: string;
  /** Disable prompt and return empty */
  skip?: boolean;
}

/**
 * Password prompt - hidden input
 *
 * @param message - Question to ask
 * @param options - Prompt options
 * @returns User's password
 * @throws PromptCancelledError if user cancels
 */
export async function password(
  message: string,
  options: PasswordOptions = {}
): Promise<string> {
  if (options.skip) {
    return "";
  }

  const promptObj: PromptObject = {
    type: "password",
    name: "value",
    message,
  };

  if (options.validate) {
    promptObj.validate = (value: string) => {
      const result = options.validate?.(value);
      if (result === true || result === undefined) {
        return true;
      }
      if (result === false) {
        return "Invalid input";
      }
      return result;
    };
  }

  const response = await prompts(promptObj, { onCancel });

  if (isCancelled(response)) {
    throw new PromptCancelledError();
  }

  const passwordValue = response.value ?? "";

  // If confirmation requested, ask again
  if (options.confirm) {
    const confirmResponse = await prompts(
      {
        type: "password",
        name: "value",
        message: "Confirm password:",
      },
      { onCancel }
    );

    if (isCancelled(confirmResponse)) {
      throw new PromptCancelledError();
    }

    if (confirmResponse.value !== passwordValue) {
      throw new Error("Passwords do not match");
    }
  }

  return passwordValue;
}

/**
 * Multiselect prompt options
 */
export interface MultiselectOptions {
  /** Initial selected indices */
  initial?: number[];
  /** Hint text */
  hint?: string;
  /** Minimum selections required */
  min?: number;
  /** Maximum selections allowed */
  max?: number;
  /** Disable prompt and return initial selections */
  skip?: boolean;
}

/**
 * Multiselect prompt - multiple selections from choices
 *
 * @param message - Question to ask
 * @param choices - Available choices
 * @param options - Prompt options
 * @returns Array of selected values
 * @throws PromptCancelledError if user cancels
 */
export async function multiselect<T>(
  message: string,
  choices: SelectChoice<T>[],
  options: MultiselectOptions = {}
): Promise<T[]> {
  if (options.skip && options.initial) {
    return options.initial
      .map((i) => choices[i]?.value)
      .filter((v): v is T => v !== undefined);
  }

  const promptChoices: Choice[] = choices.map((choice, index) => ({
    title: choice.title,
    value: choice.value,
    description: choice.description,
    disabled: choice.disabled,
    selected: options.initial?.includes(index),
  }));

  const response = await prompts(
    {
      type: "multiselect",
      name: "value",
      message,
      choices: promptChoices,
      hint: options.hint ?? "- Space to select. Return to submit",
      min: options.min,
      max: options.max,
    },
    { onCancel }
  );

  if (isCancelled(response)) {
    throw new PromptCancelledError();
  }

  return response.value ?? [];
}

/**
 * Check if error is a PromptCancelledError
 */
export function isPromptCancelled(error: unknown): error is PromptCancelledError {
  return error instanceof PromptCancelledError;
}
