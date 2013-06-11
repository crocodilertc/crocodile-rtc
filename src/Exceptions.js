(function(CrocSDK) {

	/**
	 * @constructor
	 */
	CrocSDK.Exceptions = {};

	/**
	 * This exception indicates that a parameter supplied to a method had an
	 * unexpected value.
	 * 
	 * @function CrocSDK.Exceptions#ValueError
	 * @param {String}
	 *            [message] The message to display.
	 */
	CrocSDK.Exceptions.ValueError = function(message) {
		var err = new Error();
		if (err.stack) {
			this.stack = err.stack;
		}
		this.message = message || "Unexpected value error";
	};
	CrocSDK.Exceptions.ValueError.prototype = new Error();
	CrocSDK.Exceptions.ValueError.prototype.constructor = CrocSDK.Exceptions.ValueError;
	CrocSDK.Exceptions.ValueError.prototype.name = 'ValueError';

	/**
	 * This exception indicates that a method was called at an inappropriate
	 * time. For example, calling the <code>accept()</code> method on a
	 * {@link CrocSDK.MsrpDataSession DataSession} object where the
	 * inbound session has already been accepted would result in this exception
	 * being raised.
	 * 
	 * @function CrocSDK.Exceptions#StateError
	 * @param {String}
	 *            [message] The message to display.
	 */
	CrocSDK.Exceptions.StateError = function(message) {
		var err = new Error();
		if (err.stack) {
			this.stack = err.stack;
		}
		this.message = message || "Unexpected state error";
	};
	CrocSDK.Exceptions.StateError.prototype = new Error();
	CrocSDK.Exceptions.StateError.prototype.constructor = CrocSDK.Exceptions.StateError;
	CrocSDK.Exceptions.StateError.prototype.name = 'StateError';

	/**
	 * This exception indicates that the Crocodile RTC JavaScript Library
	 * versions of the local and remote parties do not match.
	 * 
	 * @function CrocSDK.Exceptions#VersionError
	 * @param {String}
	 *            [message] The message to display.
	 */
}(CrocSDK));