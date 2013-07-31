(function(CrocSDK) {

	/**
	 * @namespace
	 */
	CrocSDK.Exceptions = {};

	/**
	 * Base exception object.
	 * @constructor Error
	 * @property {String} name
	 * The exception name.
	 * @property {String} message
	 * The message provided when the exception was created.
	 * @property {String} stack
	 * The execution stack at the time the exception was created.
	 */

	/**
	 * This exception indicates that a parameter supplied to a method had an
	 * unexpected value.
	 * 
	 * @constructor
	 * @alias CrocSDK.Exceptions.ValueError
	 * @extends Error
	 * @param {String} [message] The message to display.
	 */
	var ValueError = function(message) {
		var err = new Error();
		if (err.stack) {
			this.stack = err.stack;
		}
		this.message = message || "Unexpected value error";
	};
	ValueError.prototype = new Error();
	ValueError.prototype.constructor = ValueError;
	ValueError.prototype.name = 'ValueError';

	/**
	 * This exception indicates that a method was called at an inappropriate
	 * time. For example, calling the <code>accept()</code> method on a
	 * {@link CrocSDK.MsrpDataSession DataSession} object where the
	 * inbound session has already been accepted would result in this exception
	 * being raised.
	 * 
	 * @constructor
	 * @alias CrocSDK.Exceptions.StateError
	 * @extends Error
	 * @param {String} [message] The message to display.
	 */
	var StateError = function(message) {
		var err = new Error();
		if (err.stack) {
			this.stack = err.stack;
		}
		this.message = message || "Unexpected state error";
	};
	StateError.prototype = new Error();
	StateError.prototype.constructor = StateError;
	StateError.prototype.name = 'StateError';

	/**
	 * This exception indicates that the Crocodile RTC JavaScript Library
	 * versions of the local and remote parties do not match.
	 * 
	 * @constructor
	 * @alias CrocSDK.Exceptions.VersionError
	 * @extends Error
	 * @param {String} [message] The message to display.
	 */
	var VersionError = function(message) {
		var err = new Error();
		if (err.stack) {
			this.stack = err.stack;
		}
		this.message = message || "Version error";
	};
	VersionError.prototype = new Error();
	VersionError.prototype.constructor = VersionError;
	VersionError.prototype.name = 'VersionError';

	/**
	 * This exception indicates that a method was called at an inappropriate
	 * time. For example, calling the <code>accept()</code> method on a
	 * {@link CrocSDK.MsrpDataSession DataSession} object where the
	 * inbound session has already been accepted would result in this exception
	 * being raised.
	 * 
	 * @constructor
	 * @alias CrocSDK.Exceptions.UnsupportedError
	 * @extends Error
	 * @param {String} [message] The message to display.
	 */
	var UnsupportedError = function(message) {
		var err = new Error();
		if (err.stack) {
			this.stack = err.stack;
		}
		this.message = message || "Unsupported error";
	};
	UnsupportedError.prototype = new Error();
	UnsupportedError.prototype.constructor = UnsupportedError;
	UnsupportedError.prototype.name = 'UnsupportedError';

	CrocSDK.Exceptions.ValueError = ValueError;
	CrocSDK.Exceptions.StateError = StateError;
	CrocSDK.Exceptions.VersionError = VersionError;
	CrocSDK.Exceptions.UnsupportedError = UnsupportedError;
}(CrocSDK));
