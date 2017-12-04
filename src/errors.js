/* @flow */

export class MessageError extends Error {
  constructor(msg: string, code?: string) {
    super(msg);
    fixupErrorSubclassing(this, MessageError);
    this.code = code;
  }

  code: ?string;
}

export class ProcessSpawnError extends MessageError {
  constructor(msg: string, code?: string, process?: string) {
    super(msg, code);
    fixupErrorSubclassing(this, ProcessSpawnError);
    this.process = process;
  }

  process: ?string;
}

export class SecurityError extends MessageError {
  constructor(...args) {
    super(...args);
    fixupErrorSubclassing(this, SecurityError);
  }
}

export class ProcessTermError extends MessageError {
  EXIT_CODE: ?number;
  EXIT_SIGNAL: ?string;

  constructor(...args) {
    super(...args);
    fixupErrorSubclassing(this, ProcessTermError);
  }
}

export class ResponseError extends Error {
  constructor(msg: string, responseCode: number) {
    super(msg);
    fixupErrorSubclassing(this, ResponseError);
    this.responseCode = responseCode;
  }

  responseCode: number;
}

function fixupErrorSubclassing(instance: any, constructor: Function) {
  instance.constructor = constructor;
  instance.__proto__ = constructor.prototype;
}
