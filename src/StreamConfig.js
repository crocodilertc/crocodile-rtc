(function (CrocSDK) {
	var allowedMediaTypes = [ 'audio', 'video' ];

	CrocSDK.StreamConfig = function (config) {
		if (config instanceof CrocSDK.Sdp.Session) {
			this.fromSdp(config);
		} else if (config) {
			for (var i = 0, len = allowedMediaTypes.length; i < len; i++) {
				var type = allowedMediaTypes[i];
				if (config[type]) {
					this[type] = config[type];
				} else {
					this[type] = null;
				}
			}
		} else {
			// Default to a bi-directional audio session
			this.audio = {send: true, receive: true};
			this.video = null;
		}
	};

	CrocSDK.StreamConfig.prototype.fromSdp = function (sdp) {
		var i, len;
		for (i = 0, len = allowedMediaTypes.length; i < len; i++) {
			var type = allowedMediaTypes[i];
			this[type] = null;
		}

		for (i = 0, len = sdp.media.length; i < len; i++) {
			var mLine = sdp.media[i];
			if (allowedMediaTypes.indexOf(mLine.media) !== -1 &&
					mLine.port !== 0) {
				// Remember that our send/receive settings are the inverse
				// of what we receive in the remote party's SDP.
				this[mLine.media] = {
					send: mLine.isReceiving(),
					receive: mLine.isSending()
				};
			}
		}
	};

	CrocSDK.StreamConfig.prototype.isSending = function () {
		for (var i = 0, len = allowedMediaTypes.length; i < len; i++) {
			var type = allowedMediaTypes[i];
			if (this[type].send) {
				return true;
			}
		}
		return false;
	};

	CrocSDK.StreamConfig.prototype.getSendingStreams = function () {
		var streams = [];
		for (var i = 0, len = allowedMediaTypes.length; i < len; i++) {
			var type = allowedMediaTypes[i];
			if (this[type] && this[type].send) {
				streams.push(type);
			}
		}
		return streams;
	};

	/**
	 * Updates the stream config to be on-hold (not receiving any streams) and
	 * returns the streams that were being received.
	 * @returns {Array.<String>} The streams previously being received.
	 */
	CrocSDK.StreamConfig.prototype.hold = function () {
		var streams = [];
		for (var i = 0, len = allowedMediaTypes.length; i < len; i++) {
			var type = allowedMediaTypes[i];
			if (this[type] && this[type].receive) {
				streams.push(type);
				this[type].receive = false;
			}
		}
		return streams;
	};

	/**
	 * Takes the stream config off-hold by resuming the provided streams.
	 * @param {Array.<String>} streams - The streams previously being received.
	 */
	CrocSDK.StreamConfig.prototype.resume = function (streams) {
		for (var i = 0, len = allowedMediaTypes.length; i < len; i++) {
			var type = allowedMediaTypes[i];
			if (this[type] && streams.indexOf(type) !== -1) {
				this[type].receive = true;
			}
		}
	};

	/**
	 * Test for equality between this StreamConfig object and the provided one.
	 * They are considered equal if the same streams are present, and the stream
	 * directions match.
	 * @param {CrocSDK.StreamConfig} streamConfig - The StreamConfig object to
	 * compare with the parent object.
	 * @returns {Boolean} <code>true</code> if the objects are equivalent,
	 * <code>false</code> otherwise.
	 */
	CrocSDK.StreamConfig.prototype.equals = function (streamConfig) {
		for (var i = 0, len = allowedMediaTypes.length; i < len; i++) {
			var type = allowedMediaTypes[i];
			if (typeof this[type] !== typeof streamConfig[type]) {
				return false;
			}
			if (this[type]) {
				if (this[type].send !== streamConfig[type].send) {
					return false;
				}
				if (this[type].receive !== streamConfig[type].receive) {
					return false;
				}
			}
		}
		return true;
	};

	/**
	 * Test for equality between the sending streams of this StreamConfig object
	 * and the provided one.
	 * They are considered equal if the same sending streams are present, and the
	 * stream directions match.
	 * @param {CrocSDK.StreamConfig} streamConfig - The StreamConfig object to
	 * compare with the parent object.
	 * @returns {Boolean} <code>true</code> if the sending streams are the same,
	 * <code>false</code> otherwise.
	 */
	CrocSDK.StreamConfig.prototype.sendingStreamsEqual = function (streamConfig) {
		for (var i = 0, len = allowedMediaTypes.length; i < len; i++) {
			var type = allowedMediaTypes[i];
			if (typeof this[type] !== typeof streamConfig[type]) {
				return false;
			}
			if (this[type]) {
				if (this[type].send !== streamConfig[type].send) {
					return false;
				}
			}
		}
		return true;
	};

}(CrocSDK));
