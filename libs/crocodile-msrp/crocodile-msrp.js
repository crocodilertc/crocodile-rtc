/*! Crocodile MSRP - v0.9.0 - 2013-04-30
* http://code.google.com/p/crocodile-msrp/
* Copyright (c) 2013 Crocodile RCS Ltd; Licensed MIT */
var CrocMSRP = (function(CrocMSRP) {

	/**
	 * Creates a new ChunkReceiver object to handle an incoming chunked message.
	 * @class Tracks and combines the received components of a chunked message.
	 * @param {CrocMSRP.Message.Request} firstChunk The first received chunk:
	 * this must contain the first byte of the incoming message. Later chunks
	 * may arrive out-of-order.
	 * @param {Number} bufferSize The threshold of data to cache in memory
	 * writing the chunks out to a Blob (which will generally get stored to
	 * disk).
	 * @private
	 */
	CrocMSRP.ChunkReceiver = function(firstChunk, bufferSize) {
		if (!firstChunk || !firstChunk instanceof CrocMSRP.Message.Request) {
			throw new TypeError('Missing or unexpected parameter');
		}
		
		this.firstChunk = firstChunk;
		
		// totalBytes may be -1 if we don't know the size
		this.totalBytes = firstChunk.byteRange.total;
		this.bufferedChunks = [];
		this.bufferedBytes = 0;
		this.bufferSize = bufferSize;
		// blob contains all the contiguous message bodies we have received
		this.blob = new Blob();
		// Current blob size; cached since blob.size seems to be slow
		this.size = 0;
		// receivedBytes may be > totalBytes if we've had duplicate chunks
		this.receivedBytes = 0;
		this.aborted = false;  // true if the transfer has been aborted
		this.remoteAbort = false;  // true if the remote end aborted
		this.incontiguousChunks = {};
		this.isFile = firstChunk.contentDisposition &&
			(firstChunk.contentDisposition.type === 'attachment' ||
				firstChunk.contentDisposition.type === 'render');
		this.processChunk(firstChunk);
	};

	/**
	 * Processes subsequent chunks of the message as they arrive.
	 * @param {CrocMSRP.Message.Request} chunk The received chunk. This must be
	 * a chunk of the same message (i.e. the Message-ID must match that of the
	 * first chunk).
	 * @returns {Boolean} True if the chunk was successfully handled, false
	 * if the transfer should be aborted.
	 * @private
	 */
	CrocMSRP.ChunkReceiver.prototype.processChunk = function(chunk) {
		var chunkBody, chunkSize,
			nextStart = this.size + this.bufferedBytes + 1;
		
		if (this.aborted) {
			// The message has been aborted locally, or we've received another
			// chunk of a remote-aborted message; return error.
			return false;
		}
		
		if (chunk.messageId !== this.firstChunk.messageId) {
			console.error('Chunk has wrong message ID!');
			return false;
		}
		
		this.lastReceive = new Date().getTime();
		
		if (chunk.body instanceof ArrayBuffer) {
			// Yay! Binary frame, everything is straightforward.
			// Convert to ArrayBufferView to avoid Chrome Blob constructor warning
			// This should not be necessary: https://bugs.webkit.org/show_bug.cgi?id=88389
			chunkBody = new Uint8Array(chunk.body);
			chunkSize = chunkBody.byteLength;
		} else {
			// Boo. Text frame: turn it back into UTF-8 and cross your fingers
			// that the resulting bytes are what they should be.
			chunkBody = new Blob([chunk.body]);
			chunkSize = chunkBody.size;
		}
		this.receivedBytes += chunkSize;

		switch (chunk.continuationFlag) {
		case CrocMSRP.Message.Flag.continued:
			break;
		case CrocMSRP.Message.Flag.end:
			this.totalBytes = chunk.byteRange.start + chunkSize - 1;
			break;
		case CrocMSRP.Message.Flag.abort:
			this.abort();
			this.remoteAbort = true;
			return false;
		}
		
		if (chunk.byteRange.start === nextStart) {
			// This is the expected result; append to the write buffer
			this.bufferedChunks.push(chunkBody);
			this.bufferedBytes += chunkSize;
			nextStart += chunkSize;
			
			// Check whether there are any incontiguous chunks we can now append
			while (!CrocMSRP.util.isEmpty(this.incontiguousChunks)) {
				var nextChunk = this.incontiguousChunks[nextStart];
				if (!nextChunk) {
					// There's a gap: stop appending
					break;
				}
				delete this.incontiguousChunks[nextStart];
				
				// Add it to the disk buffer
				this.bufferedChunks.push(nextChunk);
				if (nextChunk instanceof ArrayBuffer) {
					chunkSize = nextChunk.byteLength;
				} else {
					chunkSize = nextChunk.size;
				}
				this.bufferedBytes += chunkSize;
				nextStart += chunkSize;
			}
			
			// Write out to the blob if we've exceeded the buffer size, or the
			// transfer is complete
			if (this.bufferedBytes >= this.bufferSize ||
					this.size + this.bufferedBytes === this.totalBytes) {
				writeToBlob(this);
			}
		} else if (chunk.byteRange.start > nextStart) {
			// Add this chunk to the map of incontiguous chunks
			this.incontiguousChunks[chunk.byteRange.start] = chunkBody;
		} else {
			// Duplicate chunk: RFC 4975 section 7.3.1 paragraph 3 suggests
			// that the last chunk received SHOULD take precedence.
			var array = [];
			
			// Write out the buffer in case the new chunk overlaps
			writeToBlob(this);
			
			// Construct a new blob from this chunk plus appropriate slices
			// of the existing blob.
			if (chunk.byteRange.start > 1) {
				array.push(this.blob.slice(0, chunk.byteRange.start - 1));
			}
			array.push(chunkBody);
			if (chunk.byteRange.start + chunkSize <= this.size) {
				array.push(this.blob.slice(chunk.byteRange.start + chunkSize - 1));
			}
			
			this.blob = new Blob(array, {type: this.firstChunk.contentType});
			this.size = this.blob.size;
		}
		
		return true;
	};

	/**
	 * Checks whether all expected chunks have been received.
	 * @returns {Boolean} True if all chunks have been received, or if the
	 * message has been aborted. False if we still expect further chunks.
	 * @private
	 */
	CrocMSRP.ChunkReceiver.prototype.isComplete = function() {
		return this.aborted || (this.size === this.totalBytes);
	};
	
	/**
	 * Requests that we abort this incoming chunked message. An appropriate
	 * error will be returned when we receive the next chunk.
	 * @private
	 */
	CrocMSRP.ChunkReceiver.prototype.abort = function() {
		this.aborted = true;
	};
	
	function writeToBlob(receiver) {
		if (receiver.size > 0) {
			receiver.bufferedChunks.unshift(receiver.blob);
		}
		receiver.blob = new Blob(receiver.bufferedChunks, {type: receiver.firstChunk.contentType});
		receiver.size = receiver.blob.size;
		receiver.bufferedChunks = [];
		receiver.bufferedBytes = 0;
	}
	
	return CrocMSRP;
}(CrocMSRP || {}));


var CrocMSRP = (function(CrocMSRP) {

	/**
	 * Creates a new ChunkSender object to handle an outgoing message.
	 * @class Manages the sending of a message, dividing it into chunks
	 * if required.
	 * @param {CrocMSRP.Session} session The session sending the message.
	 * @param {String|ArrayBuffer|ArrayBufferView|Blob|File} [body] The body of
	 * the message to send. If this is null or undefined then an empty SEND
	 * message will be sent.
	 * @param {String} [contentType] The MIME type of the message.
	 * @param {String} [disposition] The disposition of the message (defaults to
	 * 'inline' if not provided, or 'attachment' if the body is a File object).
	 * @param {String} [description] The description of the message. This would
	 * normally only be used when sending a file.
	 * @private
	 */
	CrocMSRP.ChunkSender = function(session, body, contentType, disposition, description) {
		if (!session) {
			throw new TypeError('Missing mandatory parameter');
		}
		
		if (!body) {
			this.blob = new Blob();
			this.contentType = null;
			this.disposition = null;
		} else if (body instanceof File) {
			this.blob = body;
			this.contentType = contentType || body.type;
			this.disposition = disposition || 'attachment; filename=' + body.name;
		} else if (body instanceof Blob) {
			this.blob = body;
			this.contentType = contentType || body.type;
			this.disposition = disposition;
		} else if (body instanceof String || typeof body === 'string') {
			this.blob = new Blob([body]);
			this.contentType = contentType || 'text/plain';
			this.disposition = disposition;
		} else if (body instanceof ArrayBuffer) {
			// Stop Chrome complaining about ArrayBuffer in Blob constructor
			this.blob = new Blob([new Uint8Array(body)]);
			this.contentType = contentType || 'application/octet-stream';
			this.disposition = disposition;
		} else if (body instanceof ArrayBufferView) {
			this.blob = new Blob([body]);
			this.contentType = contentType || 'application/octet-stream';
			this.disposition = disposition;
		} else {
			throw new TypeError('Body has unexpected type:', body);
		}
		
		this.session = session;
		this.config = session.config;
		this.messageId = CrocMSRP.util.newMID();
		
		if (this.contentType === '') {
			// We have to put something here...
			this.contentType = 'application/octet-stream';
		}
		this.description = description;
		
		this.size = this.blob.size;
		// The highest byte index sent so far
		this.sentBytes = 0;
		// The number of contiguous acked bytes
		this.ackedBytes = 0;
		// Map containing REPORT acks that arrive out-of-order (indexed by range start)
		this.incontiguousReports = {};
		this.incontiguousReportCount = 0;
		// Report timer reference
		this.reportTimer = null;
		// Optional report timeout callback
		this.onReportTimeout = null;
		this.aborted = false;
		this.remoteAbort = false;
	};

	CrocMSRP.ChunkSender.prototype.getNextChunk = function() {
		var chunk;
		
		chunk = new CrocMSRP.Message.OutgoingRequest(this.session, 'SEND');
		chunk.sender = this;
		chunk.addHeader('message-id', this.messageId);
		chunk.addHeader('success-report', 'yes');
		chunk.addHeader('failure-report', 'yes');
		
		if (this.aborted) {
			chunk.continuationFlag = CrocMSRP.Message.Flag.abort;
		} else {
			var start = this.sentBytes + 1,
				end = Math.min(this.sentBytes + this.config.chunkSize, this.size);
			chunk.byteRange = {'start': start, 'end': end, 'total': this.size};
			
			if (this.size > 0) {
				if (this.sentBytes === 0) {
					// Include extra MIME headers on first chunk
					if (this.disposition) {
						chunk.addHeader('content-disposition', this.disposition);
					} else {
						chunk.addHeader('content-disposition', 'inline');
					}
					if (this.description) {
						chunk.addHeader('content-description', this.description);
					}
				}
				
				chunk.contentType = this.contentType;
				chunk.body = this.blob.slice(this.sentBytes, end);
			}
			
			if (end < this.size) {
				chunk.continuationFlag = CrocMSRP.Message.Flag.continued;
			} else if (this.onReportTimeout) {
				var sender = this;
				this.reportTimer = setTimeout(function() {
					sender.onReportTimeout();
					sender.reportTimer = null;
				}, this.config.reportTimeout);
			}
			this.sentBytes = end;
		}

		return chunk;
	};

	/**
	 * Processes report(s) for the message as they arrive.
	 * @param {CrocMSRP.Message.Request} report The received report.  This must
	 * be a report for a message sent by this object (i.e. the Message-ID must
	 * match).
	 * @private
	 */
	CrocMSRP.ChunkSender.prototype.processReport = function(report) {
		var start, appended = true;
		
		if (report.messageId !== this.messageId) {
			console.error('REPORT has wrong message ID!');
			return;
		}
		
		if (report.status !== CrocMSRP.Status.OK) {
			this.abort();
			this.remoteAbort = true;
		} else {
			// Success report; check the byte range
			if (report.byteRange.start <= this.ackedBytes + 1) {
				if (report.byteRange.end > this.ackedBytes) {
					this.ackedBytes = report.byteRange.end;
				}
			} else if (this.incontiguousReportCount > 16) {
				// Start resending from the last acked position
				this.resume();
				return;
			} else {
				// Add this report to the map of incontiguous reports
				this.incontiguousReports[report.byteRange.start] = report.byteRange.end;
				this.incontiguousReportCount++;
				return;
			}
			
			// Check whether any previous reports are now contiguous
			while (appended) {
				appended = false;
				for (start in this.incontiguousReports) {
					if (start <= this.ackedBytes + 1) {
						if (this.incontiguousReports[start] > this.ackedBytes) {
							this.ackedBytes = this.incontiguousReports[start];
						}
						delete this.incontiguousReports[start];
						this.incontiguousReportCount--;
						appended = true;
					}
				}
			}
		}
		
		if (this.isComplete() && this.reportTimer) {
			clearTimeout(this.reportTimer);
			this.reportTimer = null;
		}
		
		return;
	};

	/**
	 * Checks whether all chunks have been sent.
	 * @returns {Boolean} True if all chunks have been sent, or if the
	 * message has been aborted. False if there are further chunks to be sent.
	 * @private
	 */
	CrocMSRP.ChunkSender.prototype.isSendComplete = function() {
		return this.aborted || (this.sentBytes >= this.size);
	};
	
	/**
	 * Checks whether all chunks have been sent and acked.
	 * @returns {Boolean} True if all chunks have been sent and acked, or if the
	 * message has been aborted. False if there are further chunks to be sent,
	 * or if there are acks outstanding.
	 * @private
	 */
	CrocMSRP.ChunkSender.prototype.isComplete = function() {
		return this.aborted || (this.ackedBytes >= this.size);
	};
	
	/**
	 * Resumes a transfer after the connection has been lost. Rewind the sent
	 * bytes to match the acknowledged position (according to received REPORTs).
	 * @private
	 */
	CrocMSRP.ChunkSender.prototype.resume = function() {
		this.sentBytes = this.ackedBytes;
		this.incontiguousReports = {};
		this.incontiguousReportCount = 0;
		console.log('Resuming at offset ' + this.sentBytes);
	};
	
	/**
	 * Requests that we abort this outgoing chunked message. The next chunk will
	 * include the abort flag.
	 * @private
	 */
	CrocMSRP.ChunkSender.prototype.abort = function() {
		this.aborted = true;

		if (this.reportTimer) {
			// Treat this as an immediate report timeout
			clearTimeout(this.reportTimer);

			var sender = this;
			this.reportTimer = setTimeout(function() {
				sender.onReportTimeout();
				sender.reportTimer = null;
			}, 0);
		}
	};
	
	return CrocMSRP;
}(CrocMSRP || {}));


var CrocMSRP = (function(CrocMSRP) {
	var reconnectTimeout = 10000;
	
	/**
	 * Creates a new connection.
	 * A single connection can support multiple sessions. The
	 * websocket connection is not actually opened until the first session
	 * is created.
	 * @class Represents a single connection to a websocket MSRP relay.
	 */
	CrocMSRP.Connection = function(relayWsUri, relayMsrpUri, config) {
		var option, defaultConfig = new CrocMSRP.ConnectionConfig();

		// Process any optional configuration options
		if (config) {
			// Copy in defaults for any missing options
			for (option in defaultConfig) {
				if (config[option] === undefined) {
					config[option] = defaultConfig[option];
				}
			}
		} else {
			// Use the defaults
			config = defaultConfig;
		}
		// Add required configuration options
		config.relayWsUri = relayWsUri;
		config.relayMsrpUri = relayMsrpUri;
		this.config = config;
		
		this.ws = null;
		this.localSessionIds = {};
		this.reconnectTimer = null;
		
		// An array of active message senders
		this.activeSenders = [];
		// The count of outstanding sends
		this.outstandingSends = 0;
	};

	/**
	 * Connects to the websocket server.
	 * @private
	 */
	CrocMSRP.Connection.prototype.connect = function() {
		if (!this.ws) {
			this.ws = new CrocMSRP.WSWrapper(this, this.config.relayWsUri);
		}
	};

	/**
	 * Creates a new session that uses this connection.  Sessions created using
	 * this method can be used to create an outgoing chat SDP offer, or accept
	 * incoming chat or file transfer SDP offers.  To create an outgoing file
	 * transfer SDP offer, use
	 * {@link CrocMSRP.Connection#createFileTransferSession} instead.
	 * Note: The websocket connection is only opened after the first session has
	 * been created.
	 * @param {CrocMSRP.Events} eventObj An object containing event callbacks
	 * to use for the new session.
	 */
	CrocMSRP.Connection.prototype.createSession = function(eventObj) {
		var sessionId, localUri;
		
		do {
			sessionId = CrocMSRP.util.newSID();
		} while (this.localSessionIds[sessionId]);
		
		localUri = new CrocMSRP.Uri();
		localUri.secure = (this.config.relayWsUri.substr(0, 3) === 'wss');
		localUri.authority = this.config.authority;
		localUri.port = 2855;
		localUri.sessionId = sessionId;
		localUri.transport = 'ws';
		this.localSessionIds[sessionId] = new CrocMSRP.Session(this, sessionId, localUri, eventObj);
		
		if (!this.ws) {
			this.connect();
		} else if (this.ws.isConnected()) {
			// Immediately start the authentication process
			this.localSessionIds[sessionId].onWsConnect();
		}
		
		return this.localSessionIds[sessionId];
	};
	
	/**
	 * Creates a new session that uses this connection.  Sessions created using
	 * this method can be used to create an outgoing file transfer SDP offer (as
	 * per RFC 5547).  For other sessions, use
	 * {@link CrocMSRP.Connection#createSession} instead.
	 * Note: The websocket connection is only opened after the first session has
	 * been created.
	 * @param {CrocMSRP.Events} eventObj An object containing event callbacks
	 * to use for the new session.
	 * @param {File} file The file that will be sent using this session.
	 * @param {CrocMSRP.FileParams} [params] Optional file parameters that may
	 * influence the construction of the SDP offer.
	 */
	CrocMSRP.Connection.prototype.createFileTransferSession = function(eventObj, file, params) {
		var session = this.createSession(eventObj);
		session.file = file;
		session.fileParams = params || {};
		return session;
	};

	/**
	 * Closes all sessions associated with this connection and  closes the
	 * websocket connection.
	 */
	CrocMSRP.Connection.prototype.disconnect = function() {
		var sessionId;
		for (sessionId in this.localSessionIds) {
			this.localSessionIds[sessionId].close();
		}
		// Socket will be closed when the last session notifies us of closure
	};

	// Internal Events
	CrocMSRP.Connection.prototype.onWsConnect = function() {
		var sessionId;
		// Notify sessions to kick off authentication process
		for (sessionId in this.localSessionIds) {
			this.localSessionIds[sessionId].onWsConnect();
		}
	};

	CrocMSRP.Connection.prototype.onWsError = function() {
		var sessionId;
		// Ungraceful disconnect
		console.log('WS Error');
		if (this.ws && !CrocMSRP.util.isEmpty(this.localSessionIds)) {
			// If there are sessions present, start a timer to reconnect
			var con = this;
			this.reconnectTimer = setTimeout(
				function() {
					con.connect();
				}, reconnectTimeout);
		}
		this.ws = null;
		this.outstandingSends = 0;
		for (sessionId in this.localSessionIds) {
			this.localSessionIds[sessionId].onWsError();
		}
	};

	CrocMSRP.Connection.prototype.onWsDisconnect = function() {
		// Graceful disconnect (on request)
		console.log('WS Disconnected');
		this.ws = null;
		this.outstandingSends = 0;
	};

	CrocMSRP.Connection.prototype.removeSession = function(sessionId) {
		delete this.localSessionIds[sessionId];
		if (CrocMSRP.util.isEmpty(this.localSessionIds)) {
			// No more sessions; close the connection
			if (this.ws) {
				this.ws.disconnect();
			}
		}
	};

	CrocMSRP.Connection.prototype.onMsrpRequest = function(req) {
		var toUri, session;
		
		// The request's To-Path should have only one URI, and that URI should
		// correspond to one of our sessions.
		if (req.toPath.length !== 1) {
			sendResponse(req, this, req.toPath[0], CrocMSRP.Status.SESSION_DOES_NOT_EXIST);
			return;
		}
		// Decode the URI
		toUri = new CrocMSRP.Uri(req.toPath[0]);
		if (!toUri) {
			sendResponse(req, this, req.toPath[0], CrocMSRP.Status.BAD_REQUEST);
			return;
		}
		// Lookup the appropriate session
		session = this.localSessionIds[toUri.sessionId];
		if (!session || !session.localUri.equals(toUri)) {
			sendResponse(req, this, req.toPath[0], CrocMSRP.Status.SESSION_DOES_NOT_EXIST);
			return;
		}

		// Check the request method
		switch (req.method) {
		case 'SEND':
			session.onIncomingSend(req);
			break;
		case 'REPORT':
			session.onIncomingReport(req);
			break;
		default:
			// Unknown method; return 501 as specified in RFC 4975 section 12
			sendResponse(req, this, req.toPath[0], CrocMSRP.Status.NOT_IMPLEMENTED);
			return;
		}
	};
	
	CrocMSRP.Connection.prototype.addSender = function(sender) {
		this.activeSenders.push(sender);
		sendRequests(this);
	};
	
	CrocMSRP.Connection.prototype.onMsrpResponse = function(res) {
		if (res.request.method === 'SEND') {
			this.outstandingSends--;
		}
		
		// Let the sending session handle the response
		res.request.session.onIncomingResponse(res);
		
		// Then send out any pending requests
		sendRequests(this);
	};
	
	function sendResponse(req, con, uri, status) {
		if (status === CrocMSRP.Status.OK) {
			if (!req.responseOn.success) {
				return;
			}
		} else {
			if (!req.responseOn.failure) {
				return;
			}
		}
		
		con.ws.send(new CrocMSRP.Message.OutgoingResponse(req, uri, status));
	}

	function sendRequests(con) {
		var sent = 0, sender;
		
		// If there are outstanding transfers, send up to two further requests.
		// This lets us ramp up the outstanding requests without locking up the
		// application.
		while (con.activeSenders.length > 0 &&
				con.outstandingSends < con.config.maxOutstandingSends &&
				sent < 2) {
			sender = con.activeSenders[0];
			if (sender.aborted && sender.remoteAbort) {
				// Don't send any more chunks; remove sender from list
				con.activeSenders.shift();
			}
			
			var msg = sender.getNextChunk();
			con.ws.send(msg);
			con.outstandingSends++;
			sent++;
			
			// Check whether this sender has now completed
			if (sender.isSendComplete()) {
				// Remove this sender from the active list
				con.activeSenders.shift();
			} else if (con.activeSenders.length > 1) {
				// For fairness, move this sender to the end of the queue
				con.activeSenders.push(con.activeSenders.shift());
			}
		}
	}
	
	return CrocMSRP;
}(CrocMSRP || {}));


/*jshint unused:vars */

var CrocMSRP = (function(CrocMSRP) {

	/**
	 * Creates a new ConnectionConfig object, with sensible defaults.
	 * @class A ConnectionConfig object contains optional configuration settings
	 * that can be passed to the constructor {@link CrocMSRP.Connection}.
	 */
	CrocMSRP.ConnectionConfig = function() {
		/**
		 * The authority (hostname) used in local MSRP URIs. This will
		 * default to a randomly-generated hostname in the 'invalid'
		 * domain.
		 * @type String
		 */
		this.authority = CrocMSRP.util.newUriAuthority();
		/**
		 * The username to use for authentication (in the MSRP AUTH request).
		 * @type String
		 */
		this.username = 'anonymous';
		/**
		 * The password to use for authentication (in the MSRP AUTH request).
		 * @type String
		 */
		this.password = '';
		/**
		 * The method name to use for authentication. This defaults to the
		 * MSRP method being challenged (i.e. 'AUTH'), but is configurable
		 * in case the server implementation expects something else (such as
		 * 'MSRP').
		 * @type String
		 */
		this.digestMethod = null;
		/**
		 * The MSRP AUTH request can include a suggested expiry time for the
		 * authentication, after which the authentication (and its associated
		 * relay URI) become invalid.  However, the server is not obliged
		 * to use the suggested time; if it falls outside of the server's
		 * minimum or maximum allowed values, the AUTH will be automatically
		 * retried with the the closest allowed value.
		 * @type Number
		 */
		this.authExpires = null;
		/**
		 * The MSRP REPORT timeout, in seconds.
		 * MSRP REPORTs are enabled by default. Any sucessfully sent message
		 * that does not receive a REPORT within this number of seconds will
		 * be reported as a failure.
		 * @type Number
		 * @see CrocMSRP.Events#onMessageFailed
		 * @see CrocMSRP.Events#onFileSendFailed
		 */
		this.reportTimeout = 120000;
		/**
		 * The list of MIME types understood by the application.
		 * Including an '*' in this list indicates that any MIME type may
		 * be sent by the far end; any received messages with MIME types
		 * that are not understood should be rejected with an
		 * {@link CrocMSRP.Exceptions.UnsupportedMedia} exception.
		 * Note that the MSRP specification (RFC 4975) mandates the support
		 * of certain types, such as 'message/cpim'.
		 * @type String[]
		 * @see CrocMSRP.Events#onMessageReceived
		 */
		this.acceptTypes = ['*'];
		/**
		 * The list of MIME types understood by the application, when wrapped
		 * within a supported container type.  By only listing supported
		 * container types in acceptTypes, an endpoint can mandate that all
		 * messages use containers whilst still having control over the
		 * encapsulated types.
		 * @type String[]
		 */
		this.acceptWrappedTypes = null;
		/**
		 * The MSRP chunk size, in bytes.
		 * Messages larger than the configured chunk size will be split into
		 * chunks for sending.  The selected chunk size has an impact on
		 * bandwidth efficiency and performance; larger chunks are more
		 * efficient, but may increase latency for other messages. It is
		 * not advisable to increase this beyond 16KB.
		 * @type Number
		 */
		this.chunkSize = 2048;
		/**
		 * The maximum number of outstanding SEND requests allowed.
		 * Increasing this number may improve performance if the connection
		 * has available bandwidth, but high latency.  However, increasing
		 * it also risks overflowing the TCP send buffer, which will cause
		 * the connection to drop.
		 * @type Number
		 */
		this.maxOutstandingSends = (32 * 1024 / this.chunkSize);
		/**
		 * The timeout for receiving a new chunk of an incoming message, in
		 * seconds.
		 * If the next chunk of an incoming message is not received within
		 * this time, an error event is raised, and the incomplete data is
		 * discarded.
		 * @type Number
		 * @see CrocMSRP.Events#onFileReceiveTimeout
		 */
		this.chunkTimeout = 30 * 1000;
		/**
		 * The receive buffer for incoming message chunks, in bytes.
		 * When receiving a message, up to this many bytes will be cached
		 * in memory before being cached in a Blob.  A larger buffer reduces
		 * disk I/O, and generally increases performance, but requires more
		 * memory.
		 * @type Number
		 */
		this.recvBuffer = 1024 * 1024;
	};
	
	return CrocMSRP;
}(CrocMSRP || {}));


var CrocMSRP = (function(CrocMSRP) {

	/**
	 * Creates a new ContentType object.
	 * @class Generic representation of a MIME type, along with optional
	 * parameters. Provides methods to convert to and from different
	 * representations.
	 */
	CrocMSRP.ContentType = function() {
		/**
		 * The MIME type.
		 * @type String
		 */
		this.type = '';
		/**
		 * The MIME sub type.
		 * @type String
		 */
		this.subtype = '';
		/**
		 * Zero or more content type parameters.
		 * @type Object
		 */
		this.params = {};
	};
	
	/**
	 * Parses an SDP type selector, as defined in RFC 5547.
	 * @param {String} selector The selector value to parse.
	 */
	CrocMSRP.ContentType.prototype.parseSdpTypeSelector = function(selector) {
		var position = 0, endIndex, param, value;
		
		// Type
		endIndex = selector.indexOf('/', position);
		if (endIndex === -1) {
			// Unexpected input
			return;
		}
		this.type = selector.slice(position, endIndex);
		position = endIndex + 1;
		
		// Subtype
		endIndex = position;
		while (endIndex < selector.length) {
			if (selector.charAt(endIndex) === ';') {
				break;
			}
			endIndex++;
		}
		this.subtype = selector.slice(position, endIndex);
		position = endIndex + 1;
		
		// Parameters
		this.params = {};
		while (selector.charAt(endIndex) === ';') {
			// Parse content type parameter
			endIndex = selector.indexOf('=', position);
			if (endIndex === -1) {
				// Unexpected input
				position = selector.length;
				return;
			}
			param = selector.slice(position, endIndex);
			position = endIndex + 1;
			
			if (selector.charAt(position) !== '"') {
				// Unexpected input
				position = selector.length;
				return;
			}
			position++;
			endIndex = selector.indexOf('"', position);
			if (endIndex === -1) {
				// Unexpected input
				position = selector.length;
				return;
			}
			value = selector.slice(position, endIndex);
			position = endIndex + 1;
			
			this.params[param] = CrocMSRP.util.decodeSdpFileName(value);
		}
	};
	
	/**
	 * Encodes the content type as an SDP type selector, as defined in RFC 5547.
	 * @returns {String} The encoded selector value.
	 */
	CrocMSRP.ContentType.prototype.toSdpTypeSelector = function() {
		var selector = '', param;
		
		selector = selector.concat(this.type, '/', this.subtype);
		for (param in this.params) {
			selector = selector.concat(';', param, '="',
				CrocMSRP.util.encodeSdpFileName(this.params[param]), '"');
		}
		
		return selector;
	};
	
	/**
	 * Parses a Content-Type header, as defined in RFC 2045.
	 * Note: Does not allow for unquoted white space.
	 * @param {String} header The header value to parse.
	 */
	CrocMSRP.ContentType.prototype.parseContentTypeHeader = function(header) {
		var position = 0, endIndex, param, value;
		
		// Type
		endIndex = header.indexOf('/', position);
		if (endIndex === -1) {
			// Unexpected input
			return;
		}
		this.type = header.slice(position, endIndex);
		position = endIndex + 1;
		
		// Subtype
		endIndex = position;
		while (endIndex < header.length) {
			if (header.charAt(endIndex) === ';') {
				break;
			}
			endIndex++;
		}
		this.subtype = header.slice(position, endIndex);
		position = endIndex + 1;
		
		// Parameters
		this.params = {};
		while (header.charAt(endIndex) === ';') {
			// Parse content type parameter
			endIndex = header.indexOf('=', position);
			if (endIndex === -1) {
				// Unexpected input
				position = header.length;
				return;
			}
			param = header.slice(position, endIndex);
			position = endIndex + 1;
			
			if (header.charAt(position) === '"') {
				position++;
				endIndex = header.indexOf('"', position);
				if (endIndex === -1) {
					// Unexpected input
					position = header.length;
					return;
				}
				while (header.charAt(endIndex - 1) === '\\') {
					endIndex = header.indexOf('"', endIndex + 1);
					if (endIndex === -1) {
						// Unexpected input
						position = header.length;
						return;
					}
				}
			} else {
				endIndex = header.indexOf(' ', position);
				if (endIndex === -1) {
					endIndex = header.length;
				}
			}
			value = header.slice(position, endIndex);
			position = endIndex + 1;
			
			this.params[param] = CrocMSRP.util.decodeQuotedString(value);
		}
	};
	
	/**
	 * Encodes the content type as an Content-Type header, as defined in RFC 2045.
	 * @returns {String} The encoded header value.
	 */
	CrocMSRP.ContentType.prototype.toContentTypeHeader = function() {
		var header = '', param;
		
		header = header.concat(this.type, '/', this.subtype);
		for (param in this.params) {
			header = header.concat(';', param, '="',
				CrocMSRP.util.encodeQuotedString(this.params[param]), '"');
		}
		
		return header;
	};
	
	return CrocMSRP;
}(CrocMSRP || {}));


/*jshint unused:vars */

var CrocMSRP = (function(CrocMSRP) {

	/**
	 * Creates an events callback object used with a {@link CrocMSRP.Session}.
	 * The methods defined here should be overrided as appropriate to your
	 * application.
	 * 
	 * @class The Session event callback object.
	 */
	CrocMSRP.Events = function() {
	};
	
	/**
	 * Event callback indicating that the session has authenticated with the
	 * MSRP websocket relay, and is ready for SDP exchange.
	 */
	CrocMSRP.Events.prototype.onAuthenticated = function() {
	};
	
	/**
	 * Event callback indicating that the provided username/password has been
	 * rejected by the MSRP websocket relay.  The session has been abandoned and
	 * will not retry.
	 */
	CrocMSRP.Events.prototype.onAuthFailed = function() {
	};
	
	/**
	 * Event callback indicating that an unexpected error has occurred, and
	 * that the session has been abandoned as a result.
	 */
	CrocMSRP.Events.prototype.onError = function() {
	};
	
	/**
	 * Event callback indicating that a message has been received for the
	 * session.
	 * 
	 * @param {String} id The Message ID of the received message.
	 * @param {String} contentType The MIME type of the received message.
	 * @param {String|ArrayBuffer|Blob} body The body of the received message.
	 * Text data will be presented as a String. Binary data may be presented
	 * as an ArrayBuffer or a Blob, depending on whether the data fit into a
	 * single chunk. Blob data can be accessed using a FileReader object
	 * (http://www.w3.org/TR/FileAPI/), or used within the page DOM by turning
	 * it into a URL: <code>var url = URL.createObjectURL(blob);</code>.
	 * @throws {CrocMSRP.Exceptions.UnsupportedMedia} If the received MIME type
	 * is not recognised/supported by the application. An appropriate error will
	 * be returned to the relay in this case.
	 */
	CrocMSRP.Events.prototype.onMessageReceived = function(id, contentType, body) {
	};
	
	/**
	 * Event callback indicating that a sent message has been acknowledged by
	 * the MSRP relay.
	 * 
	 * @param {String} id The Message ID of the sent message (as returned
	 * by the {@link CrocMSRP.Session#send} function).
	 */
	CrocMSRP.Events.prototype.onMessageSent = function(id) {
	};
	
	/**
	 * Event callback indicating that a sent message has been delivered
	 * successfully (i.e. a REPORT message has been received from the far end).
	 * 
	 * @param {String} id The Message ID of the delivered message (as
	 * returned by the {@link CrocMSRP.Session#send} function).
	 */
	CrocMSRP.Events.prototype.onMessageDelivered = function(id) {
	};

	/**
	 * Event callback indicating that an outgoing message failed. Possible
	 * reasons include an error response from the relay, an abort from the
	 * receiving party, or a timeout waiting for a REPORT from the receiving
	 * party.
	 * 
	 * @param {String} id The Message ID of the failed message (as returned
	 * by the {@link CrocMSRP.Session#send} function).
	 * @param {String} status The error status returned. If we timed out locally,
	 * this will be set to 408.
	 * @param {String} comment The error comment returned (if present). If we
	 * timed out locally, this will be set to "Report Timeout".
	 */
	CrocMSRP.Events.prototype.onMessageSendFailed = function(id, status, comment) {
	};
	
	/**
	 * Event callback indicating that the first chunk of a message has been
	 * received.  If this message only consists of a single chunk, the
	 * {@link #onChunkReceived} and {@link #onMessageReceived} events will be
	 * fired immediately after this one.
	 * To abort an unfinished transfer, call {@link CrocMSRP.Session#abortFileReceive}.
	 * 
	 * @param {String} id The Message ID of the received chunk.
	 * @param {String} contentType The MIME type of the incoming message.
	 * @param {String} filename The file name, if provided by the far end;
	 * otherwise null.
	 * @param {Number} size The file size in bytes, if provided by the far end;
	 * otherwise -1.
	 * @param {String} description The file description, if provided by the far
	 * end; otherwise null.
	 * @throws {CrocMSRP.Exceptions.UnsupportedMedia} If the received MIME type
	 * is not recognised/supported by the application. An appropriate error will
	 * be returned to the relay in this case.
	 */
	CrocMSRP.Events.prototype.onFirstChunkReceived = function(id, contentType, filename, size, description) {
	};
	
	/**
	 * Event callback indicating that an incoming message chunk has been
	 * received. This is intended to allow the transfer progress to be monitored.
	 * 
	 * @param {String} id The Message ID of the received chunk.
	 * @param {Number} receivedBytes The total bytes received so far. Note that
	 * this may become greater than the reported file size if any chunks have
	 * been resent during the transfer.
	 */
	CrocMSRP.Events.prototype.onChunkReceived = function(id, receivedBytes) {
	};
	
	/**
	 * Event callback indicating that an incoming message has been aborted.
	 * The abort may have been requested by the local or remote party.
	 * 
	 * @param {String} id The Message ID of the aborted message.
	 * @param {Blob} partialBody The partially-received message body.
	 */
	CrocMSRP.Events.prototype.onMessageReceiveAborted = function(id, partialBody) {
	};
	
	/**
	 * Event callback indicating that an incoming message has timed out.
	 * 
	 * @param {String} id The Message ID of the timed-out message.
	 * @param {Blob} partialBody The partially-received message body.
	 */
	CrocMSRP.Events.prototype.onMessageReceiveTimeout = function(id, partialBody) {
	};
	
	/**
	 * Event callback indicating that an outgoing message chunk has been
	 * sent. This is intended to allow the transfer progress to be monitored.
	 * 
	 * @param {String} id The Message ID of the sent chunk (as returned
	 * by the {@link CrocMSRP.Session#send} function).
	 * @param {Number} sentBytes The total bytes sent so far.
	 */
	CrocMSRP.Events.prototype.onChunkSent = function(id, sentBytes) {
	};
	
	CrocMSRP.mandatoryEvents = [
		'onAuthenticated',
		'onAuthFailed',
		'onError',
		'onMessageReceived',
		'onMessageSendFailed',
		'onFirstChunkReceived',
		'onMessageReceiveAborted',
		'onMessageReceiveTimeout',
		'onMessageDelivered'
	];

	return CrocMSRP;
}(CrocMSRP || {}));


var CrocMSRP = (function(CrocMSRP) {

	/**
	 * Encapsulates CrocMSRP exceptions.
	 * @namespace
	 */
	CrocMSRP.Exceptions = {};
	
	/**
	 * Creates an UnsupportedMedia exception.
	 * @class Exception thrown by the application's onMessageReceived callback
	 * if it cannot understand the MIME type of a received SEND request.
	 */
	CrocMSRP.Exceptions.UnsupportedMedia = function() {};
	CrocMSRP.Exceptions.UnsupportedMedia.prototype = new Error();
	CrocMSRP.Exceptions.UnsupportedMedia.prototype.constructor = CrocMSRP.Exceptions.UnsupportedMedia;

	/**
	 * Creates an AbortTransfer exception.
	 * @class Internal exception used to trigger a 413 response to file transfer
	 * chunks.
	 * @private
	 */
	CrocMSRP.Exceptions.AbortTransfer = function() {};
	CrocMSRP.Exceptions.AbortTransfer.prototype = new Error();
	CrocMSRP.Exceptions.AbortTransfer.prototype.constructor = CrocMSRP.Exceptions.AbortTransfer;

	return CrocMSRP;
}(CrocMSRP || {}));


var CrocMSRP = (function(CrocMSRP) {

	/**
	 * Creates a new FileParams object.
	 * @class A FileParams object contains various properties of a file that can
	 * be included in SDP (see RFC 5547). It can be passed to
	 * {@link CrocMSRP.Connection#createFileTransferSession} when creating a
	 * Session to define various properties of the file to be sent. If one is not
	 * provided, some of the details may be determined through other means.
	 * For incoming files, this object is available as
	 * {@link CrocMSRP.Session#fileParams} after having processed the incoming
	 * SDP offer.
	 */
	CrocMSRP.FileParams = function() {
		/**
		 * The file selector, as defined in RFC 5547.  At least one of the
		 * selector properties MUST be defined; in RCS-e it is recommended
		 * that both size and type are included.
		 * @type Object
		 */
		this.selector = {};
		/**
		 * The file name.  Should not include any file path elements, or
		 * characters that may be "meaningful to the local operating system".
		 * @type String
		 * @fieldOf CrocMSRP.FileParams#
		 */
		this.selector.name = '';
		/**
		 * The file size in octets.
		 * @type Number
		 * @fieldOf CrocMSRP.FileParams#
		 */
		this.selector.size = 0;
		/**
		 * The MIME type of the file.  If parameters are present, the object
		 * form is preferred; they may need to be encoded differently depending
		 * on the context.
		 * @type String|CrocMSRP.ContentType
		 * @fieldOf CrocMSRP.FileParams#
		 */
		this.selector.type = '';
		/**
		 * Zero or more hashes of the file contents.  Hashes are added to
		 * this object as properties with the hash algorithm as the property
		 * name (currently only sha1 is supported under RFC 5547), and the
		 * calculated hash as the value (pairs of upper case hex, separated
		 * by colons).
		 * @type Object
		 * @fieldOf CrocMSRP.FileParams#
		 */
		this.selector.hash = {};
		/**
		 * The file-transfer-id, which should uniquely identify the file transfer.
		 * @type String
		 */
		this.id = '';
		/**
		 * The optional file-disposition. Expected values are 'render' (the
		 * default), or 'attachment', though any IANA-registered disposition is
		 * allowed.
		 * @type String
		 */
		this.disposition = '';
		/**
		 * The optional description of the file.
		 * @type String
		 */
		this.description = '';
		/**
		 * The optional cid-url referencing a Content-ID containing a preview of
		 * the file (normally used for image thumbnails).
		 * @type String
		 */
		this.icon = '';
	};
	
	return CrocMSRP;
}(CrocMSRP || {}));


var CrocMSRP = (function(CrocMSRP) {
	var lineEnd = '\r\n';
	
	/**
	 * @namespace Encapsulates all of the MSRP message classes.
	 * @private
	 */
	CrocMSRP.Message = {};
	
	CrocMSRP.Message.Flag = {
		continued: '+',
		end: '$',
		abort: '#'
	};
	
	/**
	 * Creates a new Message object.
	 * @class Parent class for all MSRP messages.
	 * @private
	 */
	CrocMSRP.Message.Message = function() {};
	CrocMSRP.Message.Message.prototype.initMessage = function() {
		this.tid = null;
		this.toPath = [];
		this.fromPath = [];
		this.headers = {};
		this.continuationFlag = CrocMSRP.Message.Flag.end;
	};
	CrocMSRP.Message.Message.prototype.addHeader = function(name, value) {
		name = CrocMSRP.util.normaliseHeader(name);

		// Standard headers are stored in their own properties
		switch (name) {
		case 'To-Path':
			this.toPath = value.split(' ');
			return;
		case 'From-Path':
			this.fromPath = value.split(' ');
			return;
		case 'Content-Type':
			this.contentType = value;
			return;
		default:
			break;
		}
		
		if (this.headers[name]) {
			this.headers[name].push(value);
		} else {
			this.headers[name] = [value];
		}
	};
	CrocMSRP.Message.Message.prototype.getHeader = function(name) {
		name = CrocMSRP.util.normaliseHeader(name);
		if (name in this.headers) {
			if (this.headers[name].length > 1) {
				return this.headers[name];
			}
			return this.headers[name][0];
		}
		return null;
	};
	CrocMSRP.Message.Message.prototype.getEndLineNoFlag = function() {
		return '-------' + this.tid;
	};
	CrocMSRP.Message.Message.prototype.getEndLine = function() {
		return this.getEndLineNoFlag().concat(this.continuationFlag, lineEnd);
	};

	/**
	 * Creates a new Request object.
	 * @class Parent class for all MSRP requests.
	 * @extends CrocMSRP.Message.Message
	 * @private
	 */
	CrocMSRP.Message.Request = function() {};
	CrocMSRP.Message.Request.prototype = new CrocMSRP.Message.Message();
	CrocMSRP.Message.Request.prototype.constructor = CrocMSRP.Message.Request;
	CrocMSRP.Message.Request.prototype.initRequest = function() {
		this.initMessage();
		this.method = null;
		this.contentType = null;
		this.body = null;
	};
	CrocMSRP.Message.Request.prototype.addBody = function(type, body) {
		this.contentType = type;
		this.body = body;
	};
	CrocMSRP.Message.Request.prototype.addTextBody = function(text) {
		this.addBody('text/plain', text);
	};

	/**
	 * Creates a new Response object.
	 * @class Parent class for all MSRP responses.
	 * @extends CrocMSRP.Message.Message
	 * @private
	 */
	CrocMSRP.Message.Response = function() {};
	CrocMSRP.Message.Response.prototype = new CrocMSRP.Message.Message();
	CrocMSRP.Message.Response.prototype.constructor = CrocMSRP.Message.Response;
	CrocMSRP.Message.Response.prototype.initResponse = function() {
		this.initMessage();
		this.status = null;
		this.comment = null;
	};

	/**
	 * Creates a new outgoing MSRP request.
	 * @class Class representing an outgoing MSRP request.
	 * @extends CrocMSRP.Message.Request
	 * @private
	 */
	CrocMSRP.Message.OutgoingRequest = function(session, method) {
		if(!session || !method) {
			throw new TypeError('Required parameter is missing');
		}

		this.initRequest();
		this.tid = CrocMSRP.util.newTID();
		this.method = method;

		this.toPath = session.toPath;
		this.fromPath = [session.localUri];
		this.session = session;
		
		this.byteRange = null;
	};
	CrocMSRP.Message.OutgoingRequest.prototype = new CrocMSRP.Message.Request();
	CrocMSRP.Message.OutgoingRequest.prototype.constructor = CrocMSRP.Message.OutgoingRequest;
	CrocMSRP.Message.OutgoingRequest.prototype.encode = function() {
		var msg = '', name, type = this.contentType,
			end = this.getEndLine();
		
		if (this.body && (this.body instanceof String || typeof this.body === 'string')) {
			// If the body contains the end-line, change the transaction ID
			while (this.body.indexOf(end) !== -1) {
				this.tid = CrocMSRP.util.newTID();
				end = this.getEndLine();
			}
		}
		
		msg = msg.concat('MSRP ', this.tid, ' ', this.method, lineEnd);
		msg = msg.concat('To-Path: ', this.toPath.join(' '), lineEnd);
		msg = msg.concat('From-Path: ', this.fromPath.join(' '), lineEnd);
		
		if (this.byteRange) {
			var r = this.byteRange,
				total = (r.total < 0 ? '*' : r.total);
			this.addHeader('byte-range', r.start + '-' + r.end + '/' + total);
		}
		
		for (name in this.headers) {
			msg = msg.concat(name, ': ', this.headers[name].join(' '), lineEnd);
		}
		
		if (type && this.body) {
			// Content-Type is the last header, and a blank line separates the
			// headers from the message body.
			if (type instanceof CrocMSRP.ContentType) {
				type = type.toContentTypeHeader();
			}
			msg = msg.concat('Content-Type: ', type, lineEnd, lineEnd);
			
			if (this.body instanceof String || typeof this.body === 'string') {
				msg = msg.concat(this.body, lineEnd, end);
			} else {
				// Turn the entire message into a blob, encapsulating the body
				msg = new Blob([msg, this.body, lineEnd, end]);
			}
		} else {
			msg += end;
		}
				
		return msg;
	};

	/**
	 * Creates a new incoming MSRP request.
	 * @class Class representing an incoming MSRP request.
	 * @extends CrocMSRP.Message.Request
	 * @private
	 */
	CrocMSRP.Message.IncomingRequest = function(tid, method) {
		if(!tid || !method) {
			return null;
		}

		this.initRequest();
		this.tid = tid;
		this.method = method;

		switch (method) {
		case 'SEND':
			// Start by assuming responses are required
			// Can be overriden by request headers
			this.responseOn = {success: true, failure: true};
			break;
		case 'REPORT':
			// Never send responses
			this.responseOn = {success: false, failure: false};
			break;
		}
		
		this.byteRange = {start: 1, end: -1, total: -1};
	};
	CrocMSRP.Message.IncomingRequest.prototype = new CrocMSRP.Message.Request();
	CrocMSRP.Message.IncomingRequest.prototype.constructor = CrocMSRP.Message.IncomingRequest;

	/**
	 * Creates a new outgoing MSRP response.
	 * @class Class representing an outgoing MSRP response.
	 * @extends CrocMSRP.Message.Response
	 * @private
	 */
	CrocMSRP.Message.OutgoingResponse = function(request, localUri, status) {
		if(!request || !localUri) {
			return null;
		}

		this.initResponse();
		this.tid = request.tid;
		this.status = status || CrocMSRP.Status.OK;
		this.comment = CrocMSRP.StatusComment[this.status];
		
		if (request.method === 'SEND') {
			// Response is only sent to the previous hop
			this.toPath = request.fromPath.slice(0, 1);
		} else {
			this.toPath = request.fromPath;
		}
		this.fromPath = [localUri.toString()];
	};
	CrocMSRP.Message.OutgoingResponse.prototype = new CrocMSRP.Message.Response();
	CrocMSRP.Message.OutgoingResponse.prototype.constructor = CrocMSRP.Message.OutgoingResponse;
	CrocMSRP.Message.OutgoingResponse.prototype.encode = function() {
		var msg = '', name;
		
		msg = msg.concat('MSRP ', this.tid, ' ', this.status);
		if (this.comment) {
			msg = msg.concat(' ', this.comment);
		}
		msg += lineEnd;
		
		msg = msg.concat('To-Path: ', this.toPath.join(' '), lineEnd);
		msg = msg.concat('From-Path: ', this.fromPath.join(' '), lineEnd);
		
		for (name in this.headers) {
			msg = msg.concat(name, ': ', this.headers[name].join(' '), lineEnd);
		}
		
		return msg + this.getEndLine();
	};

	/**
	 * Creates a new incoming MSRP response.
	 * @class Class representing an incoming MSRP response.
	 * @extends CrocMSRP.Message.Response
	 * @private
	 */
	CrocMSRP.Message.IncomingResponse = function(tid, status, comment) {
		if(!tid || !status) {
			return null;
		}

		this.initResponse();
		this.tid = tid;
		this.status = status;
		this.comment = comment;
		this.request = null;
		this.authenticate = [];
	};
	CrocMSRP.Message.IncomingResponse.prototype = new CrocMSRP.Message.Response();
	CrocMSRP.Message.IncomingResponse.prototype.constructor = CrocMSRP.Message.IncomingResponse;

	return CrocMSRP;
}(CrocMSRP || {}));


var CrocMSRP = (function(CrocMSRP) {
	var lineEnd = '\r\n';
	
	/**
	 * @namespace Encapsulates all of the SDP classes.
	 * @private
	 */
	CrocMSRP.Sdp = {};
	
	CrocMSRP.Sdp.Session = function(sdp) {
		if (sdp) {
			// Parse the provided SDP
			if (!this.parse(sdp)) {
				return null;
			}
		} else {
			// Set some sensible defaults
			this.reset();
		}
	};
	CrocMSRP.Sdp.Session.prototype.reset = function() {
		this.version = 0;
		this.origin = new CrocMSRP.Sdp.Origin();
		this.sessionName = ' ';
		this.sessionInfo = null;
		this.uri = null;
		this.email = null;
		this.phone = null;
		this.connection = new CrocMSRP.Sdp.Connection();
		this.bandwidth = [];
		this.timing = [new CrocMSRP.Sdp.Timing()];
		this.timezone = null;
		this.key = null;
		this.resetAttributes();
		this.media = [];
	};
	CrocMSRP.Sdp.Session.prototype.addAttribute = function(name, value) {
		if (!this.attributes[name]) {
			this.attributes[name] = [];
			this.attributeNameOrder.push(name);
		}
		this.attributes[name].push(value);
	};
	CrocMSRP.Sdp.Session.prototype.removeAttribute = function(name) {
		if (this.attributes[name]) {
			delete this.attributes[name];
			this.attributeNameOrder.splice(
					this.attributeNameOrder.indexOf(name), 1);
		}
	};
	CrocMSRP.Sdp.Session.prototype.replaceAttribute = function(oldName, newName, newValue) {
		if (this.attributes[oldName]) {
			delete this.attributes[oldName];
			this.addAttribute(newName, newValue);
			this.attributeNameOrder.splice(this.attributeNameOrder.lastIndexOf(newName), 1);
			this.attributeNameOrder.splice(
					this.attributeNameOrder.indexOf(oldName), 1, newName);
		}
	};
	CrocMSRP.Sdp.Session.prototype.resetAttributes = function() {
		this.attributeNameOrder = [];
		this.attributes = {};
	};
	CrocMSRP.Sdp.Session.prototype.parse = function(sdp) {
		var line, lines = sdp.split(lineEnd), value, colonIndex, aName;
		
		this.reset();
		
		if (lines[lines.length - 1] === '') {
			// SDP ends in CRLF; remove final array index
			lines.pop();
		}
		
		if (lines.length < 4) {
			console.log('Unexpected SDP length: ' + lines.length);
			return false;
		}
		
		line = lines.shift();
		if (line !== 'v=0') {
			console.log('Unexpected SDP version: ' + line);
			return false;
		}
		
		line = lines.shift();
		if (line.substr(0, 2) !== 'o=' ||
				!(this.origin = new CrocMSRP.Sdp.Origin(line.substr(2)))) {
			console.log('Unexpected SDP origin: ' + line);
			return false;
		}
		
		line = lines.shift();
		if (line.substr(0, 2) === 's=') {
			this.sessionName = line.substr(2);
		} else {
			console.log('Unexpected SDP session name: ' + line);
			return false;
		}
		
		// Process any other optional pre-timing lines
		while (lines.length > 0 && lines[0].charAt(0) !== 't') {
			line = lines.shift();
			value = line.substr(2);
			
			switch (line.substr(0, 2)) {
			case 'i=':
				this.sessionInfo = value;
				break;
			case 'u=':
				this.uri = value;
				break;
			case 'e=':
				this.email = value;
				break;
			case 'p=':
				this.phone = value;
				break;
			case 'c=':
				value = new CrocMSRP.Sdp.Connection(value);
				if (!value) {
					return false;
				}
				this.connection = value;
				break;
			case 'b=':
				this.bandwidth.push(value);
				break;
			default:
				console.log('Unexpected SDP line (pre-timing): ' + line);
				return false;
			}
		}
		
		if (lines.length === 0) {
			console.log('Unexpected end of SDP (pre-timing)');
			return false;
		}
		
		this.timing = [];
		while (lines.length > 0 && lines[0].charAt(0) === 't') {
			line = lines.shift().substr(2);
			// Append any following r-lines
			while (lines.length > 0 && lines[0].charAt(0) === 'r') {
				line += lineEnd + lines.shift();
			}
			
			value = new CrocMSRP.Sdp.Timing(line);
			if (!value) {
				return false;
			}
			this.timing.push(value);
		}

		if (this.timing.length === 0) {
			console.log('No timing line found');
			return false;
		}
		
		// Process any optional pre-media lines
		while (lines.length > 0 && lines[0].charAt(0) !== 'm') {
			line = lines.shift();
			value = line.substr(2);
			
			switch (line.substr(0, 2)) {
			case 'z=':
				this.timezone = value;
				break;
			case 'k=':
				this.key = value;
				break;
			case 'a=':
				colonIndex = value.indexOf(':');
				if (colonIndex === -1) {
					aName = value;
					value = null;
				} else {
					aName = value.substr(0, colonIndex);
					value = value.substr(colonIndex + 1);
				}
				this.addAttribute(aName, value);
				break;
			default:
				console.log('Unexpected SDP line (pre-media): ' + line);
				return false;
			}
		}
		
		while (lines.length > 0 && lines[0].charAt(0) === 'm') {
			line = lines.shift().substr(2);
			// Append any following lines up to the next m-line
			while (lines.length > 0 && lines[0].charAt(0) !== 'm') {
				line += lineEnd + lines.shift();
			}

			value = new CrocMSRP.Sdp.Media(line);
			if (!value) {
				return false;
			}
			this.media.push(value);
		}

		return true;
	};
	CrocMSRP.Sdp.Session.prototype.toString = function() {
		var sdp = '', index, aName, aValues;
		
		sdp += 'v=' + this.version + lineEnd;
		sdp += 'o=' + this.origin + lineEnd;
		sdp += 's=' + this.sessionName + lineEnd;
		if (this.sessionInfo) {
			sdp += 'i=' + this.sessionInfo + lineEnd;
		}
		if (this.uri) {
			sdp += 'u=' + this.uri + lineEnd;
		}
		if (this.email) {
			sdp += 'e=' + this.email + lineEnd;
		}
		if (this.phone) {
			sdp += 'p=' + this.phone + lineEnd;
		}
		if (this.connection) {
			sdp += 'c=' + this.connection + lineEnd;
		}
		for (index in this.bandwidth) {
			sdp += 'b=' + this.bandwidth[index] + lineEnd;
		}
		for (index in this.timing) {
			sdp += 't=' + this.timing[index] + lineEnd;
		}
		if (this.timezone) {
			sdp += 'z=' + this.timezone + lineEnd;
		}
		if (this.key) {
			sdp += 'k=' + this.key + lineEnd;
		}
		for (var i = 0, len = this.attributeNameOrder.length; i < len; i++) {
			aName = this.attributeNameOrder[i];
			aValues = this.attributes[aName];

			for (index in aValues) {
				sdp += 'a=' + aName;
				if (aValues[index]) {
					sdp += ':' + aValues[index];
				}
				sdp += lineEnd;
			}
		}
		for (index in this.media) {
			sdp += 'm=' + this.media[index] + lineEnd;
		}
		
		return sdp;
	};

	CrocMSRP.Sdp.Origin = function(origin) {
		if (origin) {
			// Parse the provided origin line
			if (!this.parse(origin)) {
				return null;
			}
		} else {
			// Set some sensible defaults
			this.reset();
		}
	};
	CrocMSRP.Sdp.Origin.prototype.reset = function() {
		this.username = '-';
		this.id = CrocMSRP.util.dateToNtpTime(new Date());
		this.version = this.sessId;
		this.netType = 'IN';
		this.addrType = 'IP4';
		this.address = 'address.invalid';
	};
	CrocMSRP.Sdp.Origin.prototype.parse = function(origin) {
		var split;
		
		split = origin.split(' ');
		if (split.length !== 6) {
			console.log('Unexpected origin line: ' + origin);
			return false;
		}

		this.username = split[0];
		this.id = split[1];
		this.version = split[2];
		this.netType = split[3];
		this.addrType = split[4];
		this.address = split[5];
		
		return true;
	};
	CrocMSRP.Sdp.Origin.prototype.toString = function() {
		var o = '';
		
		o += this.username + ' ';
		o += this.id + ' ';
		o += this.version + ' ';
		o += this.netType + ' ';
		o += this.addrType + ' ';
		o += this.address;
		
		return o;
	};

	CrocMSRP.Sdp.Connection = function(con) {
		if (con) {
			// Parse the provided connection line
			if (!this.parse(con)) {
				return null;
			}
		} else {
			// Set some sensible defaults
			this.reset();
		}
	};
	CrocMSRP.Sdp.Connection.prototype.reset = function() {
		this.netType = 'IN';
		this.addrType = 'IP4';
		this.address = 'address.invalid';
	};
	CrocMSRP.Sdp.Connection.prototype.parse = function(con) {
		var split;
		
		split = con.split(' ');
		if (split.length !== 3) {
			console.log('Unexpected connection line: ' + con);
			return false;
		}

		this.netType = split[0];
		this.addrType = split[1];
		this.address = split[2];
		
		return true;
	};
	CrocMSRP.Sdp.Connection.prototype.toString = function() {
		var c = '';
		
		c += this.netType + ' ';
		c += this.addrType + ' ';
		c += this.address;
		
		return c;
	};

	CrocMSRP.Sdp.Timing = function(timing) {
		if (timing) {
			// Parse the provided timing line
			if (!this.parse(timing)) {
				return null;
			}
		} else {
			// Set some sensible defaults
			this.reset();
		}
	};
	CrocMSRP.Sdp.Timing.prototype.reset = function() {
		this.start = null;
		this.stop = null;
		this.repeat = [];
	};
	// Parse expects to be passed the full t-line, plus any following r-lines
	CrocMSRP.Sdp.Timing.prototype.parse = function(timing) {
		var lines, tLine, tokens;
		
		lines = timing.split(lineEnd);
		tLine = lines.shift();
		
		tokens = tLine.split(' ');
		if (tokens.length !== 2) {
			console.log('Unexpected timing line: ' + tLine);
			return false;
		}

		if (tokens[0] === '0') {
			this.start = null;
		} else {
			this.start = CrocMSRP.util.ntpTimeToDate(tokens[0]);
		}
		
		if (tokens[1] === '0') {
			this.stop = null;
		} else {
			this.stop =  CrocMSRP.util.ntpTimeToDate(tokens[1]);
		}
		
		// Don't care about repeat lines at the moment
		this.repeat = lines;
		
		return true;
	};
	CrocMSRP.Sdp.Timing.prototype.toString = function() {
		var t = '', index;
		
		if (this.start) {
			t +=  CrocMSRP.util.dateToNtpTime(this.start);
		} else {
			t += '0';
		}
		t += ' ';
		if (this.stop) {
			t +=  CrocMSRP.util.dateToNtpTime(this.stop);
		} else {
			t += '0';
		}
		
		for (index in this.repeat) {
			t += lineEnd + this.repeat[index];
		}
		
		return t;
	};

	CrocMSRP.Sdp.Media = function(media) {
		if (media) {
			// Parse the provided connection line
			if (!this.parse(media)) {
				return null;
			}
		} else {
			// Set some sensible defaults
			this.reset();
		}
	};
	CrocMSRP.Sdp.Media.prototype.reset = function() {
		this.media = 'message';
		this.port = 2855;
		this.proto = 'TCP/MSRP';
		this.format = '*';
		this.title = null;
		this.connection = null;
		this.bandwidth = [];
		this.key = null;
		this.resetAttributes();
	};
	CrocMSRP.Sdp.Media.prototype.addAttribute = function(name, value) {
		if (!this.attributes[name]) {
			this.attributes[name] = [];
			this.attributeNameOrder.push(name);
		}
		this.attributes[name].push(value);
	};
	CrocMSRP.Sdp.Media.prototype.removeAttribute = function(name) {
		if (this.attributes[name]) {
			delete this.attributes[name];
			this.attributeNameOrder.splice(
					this.attributeNameOrder.indexOf(name), 1);
		}
	};
	CrocMSRP.Sdp.Media.prototype.resetAttributes = function() {
		this.attributeNameOrder = [];
		this.attributes = {};
	};
	CrocMSRP.Sdp.Media.prototype.replaceAttribute = function(oldName, newName, newValue) {
		if (this.attributes[oldName]) {
			delete this.attributes[oldName];
			this.addAttribute(newName, newValue);
			this.attributeNameOrder.splice(this.attributeNameOrder.lastIndexOf(newName), 1);
			this.attributeNameOrder.splice(
					this.attributeNameOrder.indexOf(oldName), 1, newName);
		}
	};
	CrocMSRP.Sdp.Media.prototype.parse = function(media) {
		var lines, mLine, tokens, index, aName;
		
		this.reset();
		
		lines = media.split(lineEnd);
		mLine = lines.shift();
		
		tokens = mLine.split(' ');
		if (tokens.length < 4) {
			console.log('Unexpected media line: ' + mLine);
			return false;
		}

		this.media = tokens.shift();
		this.port = parseInt(tokens.shift(), 10);
		this.proto = tokens.shift();
		this.format = tokens.join(' ');
		
		for (index in lines) {
			var value = lines[index].substr(2), colonIndex;
			
			switch (lines[index].substr(0, 2)) {
			case 'i=':
				this.title = value;
				break;
			case 'c=':
				this.connection = new CrocMSRP.Sdp.Connection(value);
				if (!this.connection) {
					return false;
				}
				break;
			case 'b=':
				this.bandwidth.push(value);
				break;
			case 'k=':
				this.key = value;
				break;
			case 'a=':
				colonIndex = value.indexOf(':');
				if (colonIndex === -1) {
					aName = value;
					value = null;
				} else {
					aName = value.substr(0, colonIndex);
					value = value.substr(colonIndex + 1);
				}
				this.addAttribute(aName, value);
				break;
			default:
				console.log('Unexpected type (within media): ' + lines[index]);
				return false;
			}
		}
		
		return true;
	};
	CrocMSRP.Sdp.Media.prototype.toString = function() {
		var m = '', index, aName, aValues;
		
		m += this.media + ' ';
		m += this.port + ' ';
		m += this.proto + ' ';
		m += this.format;
		
		if (this.title) {
			m += lineEnd + 'i=' + this.title;
		}
		if (this.connection) {
			m += lineEnd + 'c=' + this.connection;
		}
		for (index in this.bandwidth) {
			m += lineEnd + 'b=' + this.bandwidth[index];
		}
		if (this.key) {
			m += lineEnd + 'k=' + this.key;
		}
		for (var i = 0, len = this.attributeNameOrder.length; i < len; i++) {
			aName = this.attributeNameOrder[i];
			aValues = this.attributes[aName];

			for (index in aValues) {
				m += lineEnd + 'a=' + aName;
				if (aValues[index]) {
					m += ':' + aValues[index];
				}
			}
		}
		
		return m;
	};

	CrocMSRP.Sdp.parseFileAttributes = function (media) {
		var fileParams = {}, position = 0, selector = {},
			colonIndex, name, value, endIndex,
			fileSelectorString = media.attributes['file-selector'][0];
		
		// Separate the file-selector components
		while (position < fileSelectorString.length) {
			if (fileSelectorString.charAt(position) === ' ') {
				position++;
				continue;
			}
			
			colonIndex = fileSelectorString.indexOf(':', position);
			if (colonIndex === -1) {
				break;
			}

			name = fileSelectorString.slice(position, colonIndex);
			position = colonIndex + 1;
			
			if (fileSelectorString.charAt(position) === '"') {
				// Grab everything within the quotes (possibly including spaces)
				position++;
				endIndex = fileSelectorString.indexOf('"', position);
				if (endIndex === -1) {
					break;
				}
				value = fileSelectorString.slice(position, endIndex);
				position = endIndex + 1;
			} else if (name === 'type') {
				var quoted = false;
				// Further parsing needed; find the next unquoted space
				endIndex = position;
				while (endIndex < fileSelectorString.length &&
						(quoted || fileSelectorString.charAt(endIndex) !== ' ')) {
					if (fileSelectorString.charAt(endIndex) === '"') {
						quoted = !quoted;
					}
					endIndex++;
				}
				value = new CrocMSRP.ContentType();
				value.parseSdpTypeSelector(fileSelectorString.slice(position, endIndex));
				position = endIndex + 1;
			} else {
				// Grab everything until the next space
				endIndex = fileSelectorString.indexOf(' ', position);
				if (endIndex === -1) {
					endIndex = fileSelectorString.length;
				}
				value = fileSelectorString.slice(position, endIndex);
				position = endIndex + 1;
			}
		
			switch (name) {
			case 'name':
				selector.name = CrocMSRP.util.decodeSdpFileName(value);
				break;
			case 'size':
				selector.size = parseInt(value, 10);
				break;
			case 'type':
				selector.type = value;
				break;
			case 'hash':
				if (!selector.hash) {
					selector.hash = {};
				}
				colonIndex = value.indexOf(':');
				selector.hash[value.substring(0, colonIndex)] =
					value.substring(colonIndex + 1);
				break;
			default:
				continue;
			}
		}
		fileParams.selector = selector;
		
		fileParams.id = media.attributes['file-transfer-id'][0];
		fileParams.disposition = media.attributes['file-disposition'][0] || 'render';
		if (media.title) {
			fileParams.description = media.title;
		}
		if (media.attributes['file-icon']) {
			fileParams.icon = media.attributes['file-icon'][0];
		}
		
		return fileParams;
	};
	
	return CrocMSRP;
}(CrocMSRP || {}));


var CrocMSRP = (function(CrocMSRP) {
	var states;

	// Private stuff
	states = {
		AWAIT_CONNECT: 0,
		AWAIT_CHALLENGE: 1,
		AWAIT_AUTH_RES: 2,
		AWAIT_SDP: 3,
		ESTABLISHED: 4,
		ERROR: 5,            // Final state: unrecoverable errors only
		CLOSED: 6
	};
	
	/**
	 * Creates a new Session object.
	 * Note: Session objects should not be created directly. To create a new
	 * session, use {@link CrocMSRP.Connection#createSession}.
	 * @class Represents an MSRP session with a single endpoint via the websocket relay.
	 * A single connection can host many simultaneous sessions.
	 */
	CrocMSRP.Session = function(con, sessionId, localUri, eventObj) {
		var index;
		
		// Check for mandatory methods on the event object
		if (!eventObj) {
			throw 'Event object required';
		}
		for (index in CrocMSRP.mandatoryEvents) {
			if (!eventObj[CrocMSRP.mandatoryEvents[index]]) {
				throw 'Event object missing mandatory event: ' +
					CrocMSRP.mandatoryEvents[index];
			}
		}
		
		// The connection used by this session
		this.con = con;
		// Local reference to the config object
		this.config = con.config;
		// The session ID (as used in the local URI)
		this.sessionId = sessionId;
		// The local endpoint URI for this session
		this.localUri = localUri;
		// The To-Path header for outgoing requests (set later)
		this.toPath = [];
		// The event notification object provided by the parent application
		this.eventObj = eventObj;
		
		initAuth(this);
		
		// Stuff for the SDP
		this.sdpSessId = CrocMSRP.util.dateToNtpTime(new Date());
		this.sdpSessVer = this.sdpSessId;
		// The following are negotiated in the SDP offer/answer
		/**
		 * The primary payload types accepted/understood by the far end.
		 * See RFC 4975 section 8.6.
		 * @type String[]
		 */
		this.acceptTypes = [];
		/**
		 * The payload types accepted/understood by the far end when used within
		 * an allowed container type.
		 * See RFC 4975 section 8.6.
		 * @type String[]
		 */
		this.acceptWrappedTypes = [];
		
		// A map of in-progress incoming chunked messages (indexed on message ID)
		this.chunkReceivers = {};
		this.receiverCheckInterval = null;
		// A map of in-progress outgoing messages (indexed on message ID)
		this.chunkSenders = {};

		// Initialise the session state - after this, everything should use
		// the changeState() function instead.
		this.state = states.AWAIT_CONNECT;
		this.established = false;
		/**
		 * The FileParams object describing the file being transferred in this
		 * session. For outgoing file transfers, this can be provided as a
		 * parameter when creating the session. For incoming transfers, this
		 * is populated when the incoming SDP offer is parsed.
		 * @type CrocMSRP.FileParams
		 * @see CrocMSRP.Connection#createFileTransferSession
		 * @see CrocMSRP.Session#getSdpAnswer
		 */
		this.fileParams = null;
	};

	// Public functions
	/**
	 * Creates an SDP offer for this session.
	 * @returns {String} The SDP offer. If an error is encountered, the return
	 * value will be null.
	 */
	CrocMSRP.Session.prototype.getSdpOffer = function() {
		var sdp, media;

		// Make sure we're in an appropriate state to construct the SDP
		switch (this.state) {
		case states.AWAIT_SDP:
		case states.ESTABLISHED:
			break;
		default:
			return null;
		}
		
		// Prepare the SDP media 'line' for the MSRP session
		media = new CrocMSRP.Sdp.Media();
		media.port = this.localUri.port;
		media.proto = (this.localUri.secure) ? 'TCP/TLS/MSRP' : 'TCP/MSRP';
		media.addAttribute('accept-types', this.config.acceptTypes.join(' '));
		if (this.config.acceptWrappedTypes && this.config.acceptWrappedTypes.length > 0) {
			media.addAttribute('accept-wrapped-types', this.config.acceptWrappedTypes.join(' '));
		}
		media.addAttribute('path', this.relayPath.slice().reverse().join(' ') + ' ' + this.localUri);
		
		if (this.file) {
			// This is an outgoing file transfer session; add extra SDP
			// attributes as per RFC 5547.
			var params = this.fileParams,
				selector = '',
				hash;
			
			params.selector = params.selector || {};
			// One of the following MUST be present for the file-selector
			params.selector.name = params.selector.name || this.file.name;
			params.selector.size = params.selector.size || this.file.size;
			params.selector.type = params.selector.type || this.file.type;
			params.selector.hash = params.selector.hash || {};
			
			params.id = params.id || CrocMSRP.util.newFileTransferId();
			params.disposition = params.disposition || 'render';
			
			if (params.description) {
				media.title = params.description;
			}
			if (params.selector.name) {
				selector = selector.concat('name:"',
					CrocMSRP.util.encodeSdpFileName(params.selector.name), '"');
			}
			if (params.selector.size) {
				if (selector) {
					selector += ' ';
				}
				selector = selector.concat('size:', params.selector.size);
			}
			if (params.selector.type) {
				var type;
				if (selector) {
					selector += ' ';
				}
				if (params.selector.type instanceof CrocMSRP.ContentType) {
					type = params.selector.type.toSdpTypeSelector();
				} else {
					type = params.selector.type;
				}
				selector = selector.concat('type:', type);
			}
			for (hash in params.selector.hash) {
				if (selector) {
					selector += ' ';
				}
				selector = selector.concat('hash:', hash, ':', params.selector.hash[hash]);
			}
			media.addAttribute('file-selector', selector);
			media.addAttribute('file-transfer-id', params.id);
			media.addAttribute('file-disposition', params.disposition);
			if (params.icon) {
				media.addAttribute('file-icon', params.icon);
			}
			media.addAttribute('sendonly', null);
		}
		
		// Construct the entire SDP message, appending the media 'line'
		sdp = new CrocMSRP.Sdp.Session();
		sdp.origin.username = this.config.username;
		sdp.origin.id = this.sdpSessId;
		sdp.origin.version = this.sdpSessVer;
		sdp.origin.address = this.config.authority;
		sdp.connection.address = this.config.authority;
		sdp.media.push(media);
		
		// No state change: we need the answer to finish establishing the session
		return sdp.toString();
	};
	
	/**
	 * Processes an SDP answer for this session.
	 * @param {String} answer The raw SDP answer received from the far end.
	 * @returns {String} The Message-ID of the initial session establishment
	 * message (an empty "ping" message, unless a message or file was provided
	 * when the session was created).  If an error was encountered, the return
	 * value will be null.
	 */
	CrocMSRP.Session.prototype.processSdpAnswer = function(answer) {
		var index, media, sender, msgId;
		
		switch (this.state) {
		case states.AWAIT_SDP:
		case states.ESTABLISHED:
			break;
		default:
			return null;
		}
		
		answer = new CrocMSRP.Sdp.Session(answer);
		if (!answer) {
			return null;
		}
		
		for (index in answer.media) {
			media = answer.media[index];
			
			if (media.media === 'message' && media.port !== 0 &&
					media.attributes['path'] && media.attributes['accept-types']) {
				this.farEndPath = media.attributes['path'][0].split(' ');
				this.toPath = this.relayPath.concat(this.farEndPath);
				this.acceptTypes = media.attributes['accept-types'][0].split(' ');
				if (media.attributes['accept-wrapped-types']) {
					this.acceptWrappedTypes = media.attributes['accept-wrapped-types'][0].split(' ');
				} else {
					this.acceptWrappedTypes = [];
				}
				changeState(this, states.ESTABLISHED);

				if (CrocMSRP.util.isEmpty(this.chunkSenders)) {
					// Complete the session establishment by sending a message
					var session = this;
					if (this.file) {
						// This is a file transfer session; start sending the file
						var params = this.fileParams;
						sender = new CrocMSRP.ChunkSender(this, this.file,
							params.selector.type, params.disposition,
							params.description);
					} else {
						// Empty SEND (see RFC 4975 section 5.4 paragraph 3)
						sender = new CrocMSRP.ChunkSender(this, null);
					}
				
					sender.onReportTimeout = makeTimeoutHandler(session, sender.messageId);
					this.con.addSender(sender);
					this.chunkSenders[sender.messageId] = sender;
					return sender.messageId;
				}

				// Return message ID of the first existing ongoing message sender
				for (msgId in this.chunkSenders) {
					return msgId;
				}
			}
		}
		
		return null;
	};
	
	/**
	 * Creates an SDP answer for this session, given an appropriate offer.
	 * Note: before returning the answer, the application should confirm that
	 * it understands at least one of the MIME types offered by the far end;
	 * otherwise it should return a suitable error response (e.g. SIP 488).
	 * If the incoming SDP offer is for an incoming file transfer, the
	 * {@link CrocMSRP.Session.fileParams} property will be populated. The
	 * application should confirm that it wishes to receive the described
	 * file; otherwise a suitable error response should be returned.
	 * @param {String} offer The raw SDP offer received from the far end.
	 * @returns {String} The SDP answer. If an error is encountered, the return
	 * value will be null.
	 */
	CrocMSRP.Session.prototype.getSdpAnswer = function(offer) {
		var answer, index, media, suitableMediaFound = false;
		
		switch (this.state) {
		case states.AWAIT_SDP:
		case states.ESTABLISHED:
			break;
		default:
			return null;
		}

		// Start with the offer
		answer = new CrocMSRP.Sdp.Session(offer);
		if (!answer) {
			return null;
		}
		
		// Update the origin
		answer.origin.username = this.config.username;
		answer.origin.id = this.sdpSessId;
		answer.origin.version = this.sdpSessVer;
		answer.origin.address = this.config.authority;
		
		// If connection is present, update it
		if (answer.connection) {
			answer.connection.address = this.config.authority;
		}
		
		// Find and process the first MSRP media we recognise; reject everything else
		for (index in answer.media) {
			media = answer.media[index];
			
			if (!suitableMediaFound && media.media === 'message' && media.port !== 0 &&
					(media.proto === 'TCP/MSRP' || media.proto === 'TCP/TLS/MSRP') &&
					media.attributes['path'] && media.attributes['accept-types']) {
				// Process the SDP attributes we need
				this.farEndPath = media.attributes['path'][0].split(' ');
				this.toPath = this.relayPath.concat(this.farEndPath);
				this.acceptTypes = media.attributes['accept-types'][0].split(' ');
				if (media.attributes['accept-wrapped-types']) {
					this.acceptWrappedTypes = media.attributes['accept-wrapped-types'][0].split(' ');
				} else {
					this.acceptWrappedTypes = [];
				}
				if (media.attributes['file-selector']) {
					// Incoming file transfer: extract provided info so the
					// application/user can make an informed decision on
					// whether or not to accept the file.
					this.fileParams = CrocMSRP.Sdp.parseFileAttributes(media);
					media.replaceAttribute('sendonly', 'recvonly', null);
				}
				changeState(this, states.ESTABLISHED);
				suitableMediaFound = true;
				
				// Now set the media answer values
				media.resetAttributes();
				media.port = this.localUri.port;
				media.proto = (this.localUri.secure) ? 'TCP/TLS/MSRP' : 'TCP/MSRP';
				media.addAttribute('accept-types', this.config.acceptTypes.join(' '));
				if (this.config.acceptWrappedTypes &&
						this.config.acceptWrappedTypes.length > 0) {
					media.addAttribute('accept-wrapped-types',
						this.config.acceptWrappedTypes.join(' '));
				}
				media.addAttribute('path', this.relayPath.slice().reverse().join(' ') + ' ' + this.localUri);
			} else {
				media.port = 0;
			}
		}
		
		return answer.toString();
	};
	
	/**
	 * Sends a message (or file) over an established session.
	 * @param {String|ArrayBuffer|ArrayBufferView|Blob|File} body The message
	 * body to send (may be binary data/file).
	 * @param {String} [contentType] The MIME type of the provided body.
	 * @returns {String} The Message-ID of the sent message. This can be used
	 * to correlate notifications with the appropriate message.
	 */
	CrocMSRP.Session.prototype.send = function(body, contentType) {
		var type, sender, session = this;
		if (!this.established) {
			throw 'Unable to send, session not yet established';
		}
		
		// Determine content type & size
		if (body instanceof String || typeof body === 'string') {
			type = contentType || 'text/plain';
		} else if (body instanceof Blob) {
			type = contentType || body.type || 'application/octet-stream';
		} else { // ArrayBuffer or view
			type = contentType || 'application/octet-stream';
		}
		
		sender = new CrocMSRP.ChunkSender(this, body, type);
		sender.onReportTimeout = makeTimeoutHandler(session, sender.messageId);
		this.con.addSender(sender);
		this.chunkSenders[sender.messageId] = sender;

		return sender.messageId;
	};
	
	/**
	 * Aborts an ongoing message receive.
	 * @param {String} [id] The ID of the message to abort.  If this is
	 * not specified then all incoming messages will be aborted.
	 */
	CrocMSRP.Session.prototype.abortReceive = function(id) {
		if (id) {
			var receiver = this.chunkReceivers[id];
			if (!receiver) {
				throw new RangeError('Invalid message id');
			}
			
			receiver.abort();
		} else {
			for (id in this.chunkReceivers) {
				this.chunkReceivers[id].abort();
			}
		}
		// Cleanup will happen when the next chunk is received
	};

	/**
	 * Aborts an ongoing message send.
	 * @param {String} [id] The ID of the message to abort.  If this is
	 * not specified then all outgoing sends will be aborted.
	 */
	CrocMSRP.Session.prototype.abortSend = function(id) {
		if (id) {
			var sender = this.chunkSenders[id];
			if (!sender) {
				throw new RangeError('Invalid message id');
			}
			
			sender.abort();
		} else {
			for (id in this.chunkSenders) {
				this.chunkSenders[id].abort();
			}
		}
		// Cleanup will happen when the next chunk is sent/report is received
	};

	/**
	 * Closes the session. Further messages received for this session will be
	 * rejected.
	 */
	CrocMSRP.Session.prototype.close = function() {
		this.abortReceive();
		this.abortSend();
		changeState(this, states.CLOSED);
	};

	// Internal events
	CrocMSRP.Session.prototype.onWsConnect = function() {
		sendAuth(this);
	};
	
	CrocMSRP.Session.prototype.onWsError = function() {
		// Wait for a new connection
		changeState(this, states.AWAIT_CONNECT);
	};
	
	CrocMSRP.Session.prototype.onIncomingSend = function(req) {
		var msgId, description = null, filename = null, size = -1, chunkReceiver;
		
		try {
			if (req.byteRange.start === 1 &&
					req.continuationFlag === CrocMSRP.Message.Flag.end) {
				// Non chunked message, but check whether it is an empty 'ping'
				if (req.body) {
					// Complete non-chunked, non-empty message

					// These are not required to have a Message-ID; create
					// one if it is not provided.
					msgId = req.messageId || CrocMSRP.util.newMID();
					size = req.byteRange.total;

					if (req.contentDisposition &&
							(req.contentDisposition.type === 'attachment' ||
							req.contentDisposition.type === 'render')) {
						// File transfer, extract any extra details
						description = req.getHeader('content-description');
						filename = req.contentDisposition.param.filename;
					}

					// Fire the appropriate event handlers
					this.eventObj.onFirstChunkReceived(msgId, req.contentType,
							filename, size, description);
					if (this.eventObj.onChunkReceived) {
						this.eventObj.onChunkReceived(msgId, size);
					}
					this.eventObj.onMessageReceived(msgId, req.contentType,
							req.body);
				}
			} else {
				// Chunk of a multiple-chunk message
				msgId = req.messageId;
				if (!msgId || !(msgId instanceof String || typeof msgId === 'string')) {
					sendResponse(req, this.con, this.localUri, CrocMSRP.Status.BAD_REQUEST);
					return;
				}
				
				if (req.byteRange.start === 1 &&
						req.continuationFlag === CrocMSRP.Message.Flag.continued) {
					// First chunk
					chunkReceiver = new CrocMSRP.ChunkReceiver(req, this.config.recvBuffer);
					description = req.getHeader('content-description') || null;
					filename = req.contentDisposition.param.filename || null;

					// The following may throw an UnsupportedMedia exception
					this.eventObj.onFirstChunkReceived(msgId, req.contentType,
						filename, req.byteRange.total, description);

					// The application has not rejected it, so add it to the list of
					// current receivers.
					this.chunkReceivers[msgId] = chunkReceiver;
					
					// Kick off the chunk receiver poll if it's not already running
					if (!this.receiverCheckInterval) {
						var session = this;
						this.receiverCheckInterval = setInterval(
							function() {
								checkReceivers(session);
							}, 1000
						);
					}
				} else {
					// Subsequent chunk
					chunkReceiver = this.chunkReceivers[msgId];
					if (!chunkReceiver) {
						// We assume we will receive chunk one first
						// We could allow out-of-order, but probably not worthwhile
						sendResponse(req, this.con, this.localUri, CrocMSRP.Status.STOP_SENDING);
						return;
					}
					
					if (!chunkReceiver.processChunk(req)) {
						// Message receive has been aborted
						delete this.chunkReceivers[msgId];

						if (chunkReceiver.remoteAbort) {
							// TODO: what's the appropriate response to an abort?
							sendResponse(req, this.con, this.localUri, CrocMSRP.Status.STOP_SENDING);
						} else {
							// Notify the far end of the abort
							sendResponse(req, this.con, this.localUri, CrocMSRP.Status.STOP_SENDING);
						}

						// Notify the application of the abort
						try {
							this.eventObj.onMessageReceiveAborted(msgId, chunkReceiver.blob);
						} catch (e) {
							console.warn('Unexpected application exception: ' + e.stack);
						}

						return;
					}
				}
					
				if (chunkReceiver.isComplete()) {
					delete this.chunkReceivers[msgId];
					var blob = chunkReceiver.blob;
					this.eventObj.onMessageReceived(msgId, blob.type, blob);
				} else {
					// Receive ongoing
					if (this.eventObj.onChunkReceived) {
						this.eventObj.onChunkReceived(msgId, chunkReceiver.receivedBytes);
					}
				}
			}
		} catch (e) {
			// Send an error response, but check which status to return
			var status = CrocMSRP.Status.INTERNAL_SERVER_ERROR;
			if (e instanceof CrocMSRP.Exceptions.UnsupportedMedia) {
				status = CrocMSRP.Status.UNSUPPORTED_MEDIA;
			} else {
				console.warn('Unexpected application exception: ' + e.stack);
			}
			sendResponse(req, this.con, this.localUri, status);
			return;
		}

		// Send success response
		sendResponse(req, this.con, this.localUri, CrocMSRP.Status.OK);
		
		// Send REPORT if requested
		if (req.getHeader('success-report') === 'yes') {
			sendReport(this, req);
		}
	};
	
	CrocMSRP.Session.prototype.onIncomingReport = function(report) {
		var msgId, sender;

		msgId = report.messageId;
		if (!msgId) {
			console.log('Invalid REPORT: no message id');
			return;
		}
		
		// Check whether this is for a chunk sender first
		sender = this.chunkSenders[msgId];
		if (!sender) {
			console.log('Invalid REPORT: unknown message id');
			// Silently ignore, as suggested in 4975 section 7.1.2
			return;
		}

		// Let the chunk sender handle the report
		sender.processReport(report);
		if (!sender.isComplete()) {
			// Still expecting more reports, no notification yet
			return;
		}
		
		// All chunks have been acknowledged; clean up
		delete this.chunkSenders[msgId];

		// Don't notify for locally aborted messages
		if (sender.aborted && !sender.remoteAbort) {
			return;
		}
		
		// Notify the application
		try {
			if (report.status === CrocMSRP.Status.OK) {
				if (this.eventObj.onMessageDelivered) {
					this.eventObj.onMessageDelivered(msgId);
				}
			} else {
				this.eventObj.onMessageSendFailed(msgId, report.status, report.comment);
			}
		} catch (e) {
			console.warn('Unexpected application exception: ' + e.stack);
		}
	};
	
	CrocMSRP.Session.prototype.onIncomingResponse = function(resp) {
		var msgId;

		if (resp.request.method === 'AUTH') {
			switch (resp.status) {
			case CrocMSRP.Status.UNAUTHORIZED:
				if (this.state === states.AWAIT_AUTH_RES) {
					// Another challenge - treat as a failure
					changeState(this, states.AUTH_FAILED);
				} else {
					sendAuth(this, resp);
				}
				break;
			case CrocMSRP.Status.OK:
				processAuthRes(this, resp);
				break;
			case CrocMSRP.Status.INTERVAL_OUT_OF_BOUNDS:
				// Expires header out-of-bounds, set to the min/max
				this.config.authExpires = resp.expires;
				// Try again
				sendAuth(this);
				break;
			default:
				changeState(this, states.AUTH_FAILED);
				break;
			}
			return;
		}
		
		// Otherwise it's a SEND response
		msgId = resp.request.getHeader('message-id');
		if (!msgId) {
			console.log('Can\'t retrieve SEND message id');
			return;
		}

		var sender = resp.request.sender;
		if (resp.status === CrocMSRP.Status.OK) {
			try {
				if (!sender.aborted && this.eventObj.onChunkSent) {
					this.eventObj.onChunkSent(msgId, resp.request.byteRange.end);
				}

				if (resp.request.continuationFlag === CrocMSRP.Message.Flag.end &&
						this.eventObj.onMessageSent) {
					// Notify the application
					this.eventObj.onMessageSent(msgId);
				}
			} catch (e) {
				console.warn('Unexpected application exception: ' + e.stack);
			}
		} else {
			// Failure response
			sender.abort();
			sender.remoteAbort = true;
			// Don't expect any more REPORTs
			delete this.chunkSenders[msgId];
			// Sender will be removed from Connection.activeSenders later

			// Notify the application
			try {
				this.eventObj.onMessageSendFailed(msgId, resp.status, resp.comment);
			} catch (e) {
				console.warn('Unexpected application exception: ' + e.stack);
			}
		}
	};
	
	// Private functions
	function makeTimeoutHandler(session, msgId) {
		return function() {
			delete session.chunkSenders[msgId];
			// Notify the application
			try {
				session.eventObj.onMessageSendFailed(msgId, CrocMSRP.Status.REQUEST_TIMEOUT, 'Report Timeout');
			} catch (e) {
				console.warn('Unexpected application exception: ' + e.stack);
			}
		};
	}

	function changeState(session, state) {
		console.log('Change session state: sessionId=' + session.sessionId + ', old=' + session.state + ', new=' + state);
		session.state = state;

		switch (state) {
		case states.AWAIT_CONNECT:
			session.established = false;
			initAuth(session);
			break;
		case states.AWAIT_CHALLENGE:
		case states.AWAIT_AUTH_RES:
			// May remain established whilst reauthenticating
			break;
		case states.AWAIT_SDP:
			// May remain established whilst reauthenticating
			session.sdpSessVer = CrocMSRP.util.dateToNtpTime(new Date());
			try {
				session.eventObj.onAuthenticated();
			} catch (e) {
				console.warn('Unexpected application exception: ' + e.stack);
			}
			break;
		case states.ESTABLISHED:
			if (!session.established && !CrocMSRP.util.isEmpty(this.chunkSenders)) {
				// Resume outgoing transfers from the acknowledged position
				var msgId;
				for (msgId in this.chunkSenders) {
					this.chunkSenders[msgId].resume();
				}
			}
			session.established = true;
			// Nothing to do here
			break;
		case states.AUTH_FAILED:
			session.established = false;
			initAuth(session);
			try {
				session.eventObj.onAuthFailed();
			} catch (e) {
				console.warn('Unexpected application exception: ' + e.stack);
			}
			session.con.removeSession(session.sessionId);
			break;
		case states.ERROR:
			session.established = false;
			initAuth(session);
			try {
				session.eventObj.onError();
			} catch (e) {
				console.warn('Unexpected application exception: ' + e.stack);
			}
			session.con.removeSession(session.sessionId);
			break;
		case states.CLOSED:
			session.established = false;
			initAuth(session);
			session.con.removeSession(session.sessionId);
			break;
		default:
			console.error('Invalid state: ' + state);
			changeState(session, states.ERROR);
			break;
		}
	}
	
	function initAuth(session) {
		// (re)Initialise any properties used by the authentication process

		// Clear the auth timer if it's running
		if (session.authTimer) {
			clearTimeout(session.authTimer);
			session.authTimer = null;
		}
		// As we receive relay URIs they will be appended here, and the toPath reconstructed
		session.relayPath = [];
		// Once SDP negotiation has provided the far end path, it will be stored
		// here, and appended to the toPath.
		session.farEndPath = [];
	}
	
	function sendAuth(session, resp) {
		var authReq;
		
		authReq = new CrocMSRP.Message.OutgoingRequest(session, 'AUTH');
		
		// Override the To-Path of the request
		authReq.toPath = [session.config.relayMsrpUri];

		if (resp) {
			var index, authorisation = null;
				
			if (!resp.authenticate) {
				console.log('Auth failed: no WWW-Authenticate header available');
				changeState(session, states.ERROR);
				return;
			}
			
			for (index in resp.authenticate) {
				authorisation = CrocMSRP.digestAuthentication(session.config,
					resp.request, resp.authenticate[index]);
				if (authorisation) {
					break;
				}
			}
			
			if (!authorisation || authorisation.length === 0) {
				console.log('Construction of authorization failed');
				changeState(session, states.ERROR);
				return;
			}
			
			authReq.addHeader('authorization', authorisation);
			changeState(session, states.AWAIT_AUTH_RES);
		} else {
			changeState(session, states.AWAIT_CHALLENGE);
		}
		
		if (session.config.authExpires) {
			// Set the requested auth duration
			authReq.addHeader('expires', session.config.authExpires);
		}
		
		session.con.ws.send(authReq);
	}

	function processAuthRes(session, resp) {
		if (!resp.usePath) {
			console.log('Use-Path header missing!');
			changeState(session, states.ERROR);
			return;
		}
		
		session.relayPath = resp.usePath;
		session.authTimer = setTimeout(
			function() {
				session.authTimer = null;
				initAuth(session);
				sendAuth(session);
			}, (resp.expires - 30) * 1000);
		
		changeState(session, states.AWAIT_SDP);
	}
	
	function sendResponse(req, con, uri, status) {
		if (status === CrocMSRP.Status.OK) {
			if (!req.responseOn.success) {
				return;
			}
		} else {
			if (!req.responseOn.failure) {
				return;
			}
		}
		
		con.ws.send(new CrocMSRP.Message.OutgoingResponse(req, uri, status));
	}
	
	function sendReport(session, req) {
		var report;
		
		report = new CrocMSRP.Message.OutgoingRequest(session, 'REPORT');
		report.addHeader('message-id', req.messageId);
		report.addHeader('status', '000 200 OK');

		if (req.byteRange ||
				req.continuationFlag === CrocMSRP.Message.Flag.continued) {
			// A REPORT Byte-Range will be required
			var start = 1, end, total = -1;
			if (req.byteRange) {
				// Don't trust the range end
				start = req.byteRange.start;
				total = req.byteRange.total;
			}
			if (!req.body) {
				end = 0;
			} else if (req.body instanceof ArrayBuffer) {
				// Yay! Binary frame: the length is obvious.
				end = start + req.body.byteLength - 1;
			} else {
				// Boo. Text frame: turn it back into UTF-8 and cross your fingers
				// that the resulting bytes (and length) are what they should be.
				var blob = new Blob([req.body]);
				end = start + blob.size - 1;
				// blob.close();
			}
			
			if (end !== req.byteRange.end) {
				console.warn('Report Byte-Range end does not match request');
			}
			
			report.byteRange = {'start': start, 'end': end, 'total': total};
		}
		
		session.con.ws.send(report);
	}
	
	function checkReceivers(session) {
		var msgId, receiver,
			now = new Date().getTime(),
			timeout = session.config.chunkTimeout;
		for (msgId in session.chunkReceivers) {
			receiver = session.chunkReceivers[msgId];
			if (now - receiver.lastReceive > timeout) {
				// Clean up the receiver
				receiver.abort();
				delete session.chunkReceivers[msgId];
				try {
					session.eventObj.onMessageReceiveTimeout(msgId, receiver.blob);
				} catch (e) {
					console.warn('Unexpected application exception: ' + e.stack);
				}
			}
		}
		
		if (CrocMSRP.util.isEmpty(session.chunkReceivers)) {
			clearInterval(session.receiverCheckInterval);
			session.receiverCheckInterval = null;
		}
	}
	
	return CrocMSRP;
}(CrocMSRP || {}));


var CrocMSRP = (function(CrocMSRP) {
	/** @constant */
	CrocMSRP.Status = {
		OK: 200,
		BAD_REQUEST: 400,
		UNAUTHORIZED: 401,
		FORBIDDEN: 403,
		REQUEST_TIMEOUT: 408,
		STOP_SENDING: 413,
		UNSUPPORTED_MEDIA: 415,
		INTERVAL_OUT_OF_BOUNDS: 423,
		SESSION_DOES_NOT_EXIST: 481,
		INTERNAL_SERVER_ERROR: 500, // Not actually defined in spec/registry!
		NOT_IMPLEMENTED: 501,
		WRONG_CONNECTION: 506
	};
	
	/** @constant */
	CrocMSRP.StatusComment = {
		200: 'OK',
		400: 'Bad Request',
		401: 'Unauthorized',
		403: 'Forbidden',
		408: 'Request Timeout',
		413: 'Stop Sending Message',
		415: 'Unsupported Media Type',
		423: 'Interval Out-of-Bounds',
		481: 'Session Does Not Exist',
		500: 'Internal Server Error', // Not actually defined in spec/registry!
		501: 'Not Implemented',
		506: 'Wrong Connection'
	};
	
	return CrocMSRP;
}(CrocMSRP || {}));


var CrocMSRP = (function(CrocMSRP) {

	CrocMSRP.Uri = function(uri) {
		this.secure = false;
		this.user = null;
		this.authority = '';
		this.port = null;
		this.sessionId = '';
		this.transport = 'tcp';
		
		if (uri) {
			this.uri = uri;
			this.parse(uri);
		}
	};

	CrocMSRP.Uri.prototype.parse = function(uri) {
		var colonIndex = uri.indexOf('://'),
			scheme, atIndex, portSepIndex, pathIndex, semicolonIndex;
		
		if (colonIndex === -1) {
			throw new TypeError('Invalid MSRP URI: ' + uri);
		}
		
		// Extract the scheme first
		scheme = uri.substring(0, colonIndex);
		switch (scheme.toLowerCase()) {
		case 'msrp':
			this.secure = false;
			break;
		case 'msrps':
			this.secure = true;
			break;
		default:
			throw new TypeError('Invalid MSRP URI (unknown scheme): ' + uri);
		}
		
		// Start by assuming that the authority is everything between "://" and "/"
		pathIndex = uri.indexOf('/', colonIndex + 3);
		if (pathIndex === -1) {
			throw new TypeError('Invalid MSRP URI (no session ID): ' + uri);
		}
		this.authority = uri.substring(colonIndex + 3, pathIndex);
		
		// If there's an "@" symbol in the authority, extract the user
		atIndex = this.authority.indexOf('@');
		if (atIndex !== -1) {
			this.user = this.authority.substr(0, atIndex);
			this.authority = this.authority.substr(atIndex + 1);
		}
		
		// If there's an ":" symbol in the authority, extract the port
		portSepIndex = this.authority.indexOf(':');
		if (portSepIndex !== -1) {
			this.port = this.authority.substr(portSepIndex + 1);
			this.authority = this.authority.substr(0, portSepIndex);
		}
		
		// Finally, separate the session ID from the transport
		semicolonIndex = uri.indexOf(';', colonIndex + 3);
		if (semicolonIndex === -1) {
			throw new TypeError('Invalid MSRP URI (no transport): ' + uri);
		}
		this.sessionId = uri.substring(pathIndex + 1, semicolonIndex);
		this.transport = uri.substring(semicolonIndex + 1);
		
		return true;
	};

	CrocMSRP.Uri.prototype.toString = function() {
		var uri = 'msrp';
		
		if (this.uri) {
			// Return the cached URI
			return this.uri;
		}
		
		if (this.secure) {
			uri += 's';
		}
		
		uri += '://';

		if (this.user) {
			uri += this.user + '@';
		}
		
		uri += this.authority;

		if (this.port) {
			uri += ':' + this.port;
		}
		
		uri += '/' + this.sessionId + ';' + this.transport;
		
		this.uri = uri;
		return uri;
	};
	
	CrocMSRP.Uri.prototype.equals = function(uri) {
		if (typeof uri === 'string' || uri instanceof String) {
			uri = new CrocMSRP.Uri(uri);
		}
		
		if (!uri instanceof Object) {
			return false;
		}
		
		if (uri.secure !== this.secure) {
			return false;
		}
		
		// Strictly we should be checking whether percent-encoding normalisation
		// is needed, but it's not likely to be needed.
		if (uri.authority.toLowerCase() !== this.authority.toLowerCase()) {
			return false;
		}
		
		if (parseInt(uri.port, 10) !== parseInt(this.port, 10)) {
			return false;
		}
		
		if (uri.sessionId !== this.sessionId) {
			return false;
		}
		
		if (uri.transport.toLowerCase() !== this.transport.toLowerCase()) {
			return false;
		}
		
		return true;
	};

	return CrocMSRP;
}(CrocMSRP || {}));


/* jshint unused:vars */

var CrocMSRP = (function(CrocMSRP) {
	var states;
	
	states = {
		INIT: 0,
		CONNECTING: 1,
		CONNECTED: 2,
		ERROR: 3,
		DISCONNECTING: 4,
		DISCONNECTED: 5
	};
	
	CrocMSRP.WSWrapper = function(con, relayUri) {
		this.con = con;
		this.relayUri = relayUri;

		this.state = states.INIT;

		this.ws = null;
		// Object for tracking outstanding transaction IDs (for sent requests)
		this.transactions = {};
		
		this.connect();
	};

	CrocMSRP.WSWrapper.prototype.isConnected = function() {
		return this.state === states.CONNECTED;
	};

	CrocMSRP.WSWrapper.prototype.connect = function() {
		var ws, wrapper = this;

		this.state = states.CONNECTING;
		console.log("Attempting WebSocket Connection to " + this.relayUri);
		
		try {
			ws = new WebSocket(this.relayUri, 'msrp');
		} catch (e) {
			console.log("Connection error: " + e);
			return false;
		}
		
		// We expect relatively small messages, so hint to keep in memory
		ws.binaryType = "arraybuffer";
		
		// Register callbacks
		ws.onopen = function(e) { wrapper.onOpen(e); };
		ws.onerror = function(e) { wrapper.onError(e); };
		ws.onclose = function(e) { wrapper.onClose(e); };
		ws.onmessage = function(e) { wrapper.onMessage(e); };
		
		this.running = true;
		this.ws = ws;
		
		return true;
	};

	CrocMSRP.WSWrapper.prototype.disconnect = function() {
		this.state = states.DISCONNECTING;
		if (this.ws) {
			this.ws.close();
		}
	};

	CrocMSRP.WSWrapper.prototype.send = function(message) {
		var wsWrapper = this;
		if (this.state !== states.CONNECTED || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.log("Send failed: socket not ready");
			return false;
		}
		
		if (message instanceof CrocMSRP.Message.Request && message.method !== 'REPORT') {
			message.timer = setTimeout(function(){timeout(wsWrapper, message);}, 30000);
			this.transactions[message.tid] = message;
		}
		
		try {
			this.ws.send(message.encode());
		} catch (e) {
			console.log("Send failed: " + e);
			return false;
		}
		
		return true;
	};

	CrocMSRP.WSWrapper.prototype.onOpen = function(event) {
		this.state = states.CONNECTED;
		this.con.onWsConnect();
	};

	CrocMSRP.WSWrapper.prototype.onError = function(event) {
		// This should be followed by onClose, so don't need to do much here
		this.state = states.ERROR;
		console.log('WebSocket error');
	};

	CrocMSRP.WSWrapper.prototype.onClose = function(event) {
		if (this.state === states.DISCONNECTING) {
			// Report the successful disconnect
			this.con.onWsDisconnect();
		} else {
			console.warn("WebSocket closed unexpectedly: wasClean=" + event.wasClean + " code=" + event.code);
			// Report the failure
			this.con.onWsError();
		}
		this.state = states.DISCONNECTED;
	};

	CrocMSRP.WSWrapper.prototype.onMessage = function(event) {
		// Parse MSRP message
		var msg = CrocMSRP.parseMessage(event.data);
		if (!msg) {
			// Oh dear
			this.state = states.ERROR;
			console.log('MSRP message parsing error; closing websocket');
			this.ws.close();
			return;
		}
		
		if (msg instanceof CrocMSRP.Message.Response) {
			// Check for outstanding transaction
			msg.request = this.transactions[msg.tid];
			if (msg.request) {
				clearTimeout(msg.request.timer);
				delete msg.request.timer;
				delete this.transactions[msg.tid];
				this.con.onMsrpResponse(msg);
			} else {
				console.log("Unexpected response received; not in transaction list");
			}
			return;
		}
		
		// Send requests up to the con
		this.con.onMsrpRequest(msg);
	};

	function timeout(wsWrapper, request) {
		delete request.timer;
		delete wsWrapper.transactions[request.tid];
		var resp = new CrocMSRP.Message.IncomingResponse(request.tid, 408, CrocMSRP.StatusComment[408]);
		resp.request = request;
		wsWrapper.con.onMsrpResponse(resp);
	}
	
	return CrocMSRP;
}(CrocMSRP || {}));


var CrocMSRP;

var CrocMSRP = (function(CrocMSRP) {
	var paramSep = ', ';
	var md5 = typeof JsSIP === 'undefined' ? hex_md5 : JsSIP.Utils.calculateMD5;
	
	/**
	 * Performs HTTP digest authentication.
	 * @private
	 */
	CrocMSRP.digestAuthentication = function(config, req, authenticate) {
		var authorization = 'Digest ',
			digestUri = req.toPath[req.toPath.length - 1],
			qop = null,
			nc = '00000001',
			cnonce = Math.random().toString(36).substr(2, 12),
			HA1, HA2, response;
		
		if (authenticate.qop) {
			if (authenticate.qop.split(' ').indexOf('auth') !== -1) {
				qop = 'auth';
			}
		}

		authorization += 'username="' + config.username + '"';
		authorization += paramSep + 'realm="' + authenticate.realm + '"';
		authorization += paramSep + 'nonce="' + authenticate.nonce + '"';
		authorization += paramSep + 'uri="' + digestUri + '"';
		
		// HA1 = MD5(A1) = MD5(username:realm:password)
		HA1 = md5(config.username + ':' + authenticate.realm + ':' + config.password);
		// HA2 = MD5(A2) = MD5(method:digestUri)
		// Some confusion over what to use as the method; Kamailio uses "MSRP"
		if (config.digestMethod) {
			HA2 = md5(config.digestMethod + ':' + digestUri);
		} else {
			HA2 = md5(req.method + ':' + digestUri);
		}

		if (qop) {
			// response = MD5(HA1:nonce:nc:cnonce:qop:HA2)
			response = md5(HA1 + ':' + authenticate.nonce + ':' + nc + ':' + cnonce + ':auth:' + HA2);
		} else {
			// response = MD5(HA1:nonce:HA2)
			response = md5(HA1 + ':' + authenticate.nonce + ':' + HA2);
		}
		authorization += paramSep + 'response="' + response + '"';
		
		if (authenticate.algorithm) {
			if (authenticate.algorithm !== 'MD5') {
				console.log('Auth failure: unsupported "algorithm" parameter in challenge');
				return null;
			}
			authorization += paramSep + 'algorithm=MD5';
		}
		
		if (qop) {
			authorization += paramSep + 'qop=' + qop;
			authorization += paramSep + 'cnonce="' + cnonce + '"';
			authorization += paramSep + 'nc=' + nc;
		}

		if (authenticate.opaque) {
			authorization += paramSep + 'opaque="' + authenticate.opaque + '"';
		}
		
		return authorization;
	};
	
	return CrocMSRP;
}(CrocMSRP));


var CrocMSRP = (function(CrocMSRP) {
	var lineEnd = '\r\n';
	
	/**
	 * Parses a raw websocket message and returns a Message object.
	 * @param {String|ArrayBuffer} data Event data from the onmessage websocket event.
	 * @returns {CrocMSRP.Message.Message} Message object, or null if there an
	 * error is encountered.
	 * @private
	 */
	CrocMSRP.parseMessage = function(data) {
		var msg, startIndex = 0, endIndex, firstLine, tokens, statusCode, msgObj,
			parseResult, endLineNoFlag;
		
		if (data instanceof ArrayBuffer) {
			// Turn the ArrayBuffer into a string, assuming one-byte chars
			// The body will get sliced out once we locate it
			msg = String.fromCharCode.apply(null, new Uint8Array(data)); 
		} else if (data instanceof String || typeof data === 'string') {
			msg = data;
		} else {
			console.log('Unexpected parameter type');
			return null;
		}
		
		// Extract and parse the first line
		endIndex = msg.indexOf(lineEnd);
		if (endIndex === -1) {
			console.log('Error parsing message: no CRLF');
			return null;
		}
		
		firstLine = msg.substring(startIndex, endIndex);
		tokens = firstLine.split(' ');
		if (tokens.length < 3 || tokens[0] !== 'MSRP' ||
				tokens[1].length === 0 || tokens[2].length === 0) {
			console.log('Error parsing message: unexpected first line format: ' + firstLine);
			return null;
		}
		
		// Determine whether it is a request or response and construct the
		// appropriate object
		if (tokens[2].length === 3 && (statusCode = parseInt(tokens[2], 10))) {
			if (tokens.length > 3) {
				var comment = tokens.slice(3).join(' ');
				msgObj = new CrocMSRP.Message.IncomingResponse(tokens[1], statusCode, comment);
			} else {
				msgObj = new CrocMSRP.Message.IncomingResponse(tokens[1], statusCode);
			}
		} else if (tokens.length === 3) {
			msgObj = new CrocMSRP.Message.IncomingRequest(tokens[1], tokens[2]);
		} else {
			console.log('Error parsing message: unexpected first line format: ' + firstLine);
			return null;
		}
		
		// Iterate through the headers, adding them to the object
		startIndex = endIndex + lineEnd.length;
		while (true) {
			parseResult = getNextHeader(msg, startIndex, msgObj);
			if (parseResult > 0) {
				startIndex = parseResult;
			} else if (parseResult === 0) {
				break;
			} else {
				return null;
			}
		}
		
		// Perform further processing on selected headers
		if (!parseKnownHeaders(msgObj)) {
			console.log("Error parsing message: parseKnownHeaders failed");
			return null;
		}
		
		// Extract the message body (if present)
		endLineNoFlag = msgObj.getEndLineNoFlag();
		if (msg.substr(startIndex, lineEnd.length) === lineEnd) {
			// Empty line after headers indicates presence of a message body
			startIndex += lineEnd.length;
			endIndex = msg.indexOf(lineEnd + endLineNoFlag, startIndex);
			if (endIndex === -1) {
				console.log("Error parsing message: no end line after body");
				return null;
			}
			if (data instanceof ArrayBuffer) {
				// Slice out the body of the message from the original ArrayBuffer
				msgObj.body = data.slice(startIndex, endIndex);
			} else {
				// Assume we're only dealing with text
				msgObj.body = msg.substring(startIndex, endIndex);
			}

			msgObj.continuationFlag = msg.charAt(endIndex + lineEnd.length + endLineNoFlag.length);
		} else {
			msgObj.continuationFlag = msg.charAt(startIndex + endLineNoFlag.length);
		}
		
		return msgObj;
	};

	/**
	 * Remove any leading or trailing whitespace from the provided string.
	 * @param {String} str The string to process.
	 * @returns {String} The trimmed string.
	 * @private
	 */
	function chomp(str) {
		return str.replace(/^\s+/, '').replace(/\s+$/, '');
	}
	
	/**
	 * Remove double quotes from the start and end of the string, if present.
	 * @param {String} str The string to process.
	 * @returns {String} The unquoted string.
	 * @private
	 */
	function unq(str) {
		return str.replace(/^"/, '').replace(/"$/, '');
	}

	// Extracts the next header after startIndex, and adds it to the provided message object
	// Returns: Positive value: the new message position when a header is extracted
	//          0 if there are no more headers
	//          -1 if it encounters an error
	function getNextHeader(msg, startIndex, msgObj) {
		var endIndex, colonIndex, name, value,
			endLineNoFlag = msgObj.getEndLineNoFlag();
		
		// If there is a body, there will be an extra CRLF between the headers and
		// the body. If there is no body, we stop at the end-line.
		if (msg.substr(startIndex, 2) === '\r\n' ||
				msg.substr(startIndex, endLineNoFlag.length) === endLineNoFlag) {
			return 0;
		}
		
		endIndex = msg.indexOf('\r\n', startIndex);
		if (endIndex === -1) {
			// Oops - invalid message
			console.log('Error parsing header: no CRLF');
			return -1;
		}

		colonIndex = msg.indexOf(':', startIndex);
		if (colonIndex === -1) {
			// Oops - invalid message
			console.log('Error parsing header: no colon');
			return -1;
		}
		
		name = chomp(msg.substring(startIndex, colonIndex));
		if (name.length === 0) {
			console.log('Error parsing header: no name');
			return -1;
		}
		
		value = chomp(msg.substring(colonIndex + 1, endIndex));
		if (name.length === 0) {
			console.log('Error parsing header: no value');
			return -1;
		}
		
		msgObj.addHeader(name, value);
		
		return endIndex + 2;
	}

	function getNextAuthParam(str, startIndex, obj) {
		var equalsIndex, endIndex, name, value;
		
		// Find the next equals sign, which indicates the end of the parameter name
		equalsIndex = str.indexOf('=', startIndex);
		if (equalsIndex === -1) {
			return -1;
		}
		
		// Look for the end of this parameter, starting after the equals sign
		endIndex = equalsIndex + 1;
		if (str.charAt(endIndex) === '"') {
			// Quoted string - find the end quote
			// We assume that the string cannot itself contain double quotes,
			// as RFC 2617 makes no mention of escape sequences.
			endIndex = str.indexOf('"', endIndex + 1);
			if (endIndex === -1) {
				return -1;
			}
		}
		
		// The parameter value continues until the next unquoted comma, or the
		// end of the header line.
		endIndex = str.indexOf(',', endIndex);
		if (endIndex === -1) {
			endIndex = str.length;
		}
		
		// Trim any whitespace/quotes
		name = chomp(str.substring(startIndex, equalsIndex));
		value = unq(chomp(str.substring(equalsIndex + 1, endIndex)));
		
		// Check we've got something sensible
		if (name.length === 0 || value.length === 0) {
			return -1;
		}
		
		// Add the param to the result object, and return the current position
		// in the header line.
		obj[name] = value;
		return endIndex + 1;
	}
	
	function parseWwwAuthenticate(headerArray, msgObj) {
		var hdrIndex, value, authenticate, strIndex;
		
		// There could be multiple WWW-Authenticate headers, each giving
		// different algorithms or other options.
		for (hdrIndex in headerArray) {
			value = headerArray[hdrIndex];
			authenticate = {};
			
			if (!value.match(/^Digest /)) {
				return false;
			}
			
			strIndex = 7;
			while (strIndex !== -1 && strIndex < value.length) {
				strIndex = getNextAuthParam(value, strIndex, authenticate);
			}
			if (strIndex === -1) {
				return false;
			}
			
			msgObj.authenticate.push(authenticate);
		}
		return true;
	}
	
	function parseByteRange(headerArray, msgObj) {
		var value, range = {}, rangeSepIndex, totalSepIndex;
		
		// We only expect one Byte-Range header
		if (headerArray.length !== 1) {
			return false;
		}
		value = headerArray[0];
		
		rangeSepIndex = value.indexOf('-');
		totalSepIndex = value.indexOf('/', rangeSepIndex);
		if (rangeSepIndex === -1 || totalSepIndex === -1) {
			console.log('Unexpected Byte-Range format: ' + value);
			return false;
		}
		
		range.start = parseInt(chomp(value.substring(0, rangeSepIndex)), 10);
		range.end = chomp(value.substring(rangeSepIndex + 1, totalSepIndex));
		if (range.end === '*') {
			range.end = -1;
		} else {
			range.end = parseInt(range.end, 10);
		}
		range.total = chomp(value.substring(totalSepIndex + 1));
		if (range.total === '*') {
			range.total = -1;
		} else {
			range.total = parseInt(range.total, 10);
		}
		
		if (isNaN(range.start) || isNaN(range.end) || isNaN(range.total)) {
			console.log('Unexpected Byte-Range values: ' + value);
			return false;
		}
		
		msgObj.byteRange = range;
		return true;
	}
	
	function parseFailureReport(headerArray, msgObj) {
		// We only expect one Failure-Report header
		if (headerArray.length !== 1) {
			console.log('Multiple Failure-Report headers');
			return false;
		}
		
		switch (headerArray[0].toLowerCase()) {
		case 'yes':
			msgObj.responseOn = {success: true, failure: true};
			break;
		case 'no':
			msgObj.responseOn = {success: false, failure: false};
			break;
		case 'partial':
			msgObj.responseOn = {success: false, failure: true};
			break;
		default:
			console.log('Unexpected Failure-Report header: ' + headerArray[0]);
			return false;
		}
		
		return true;
	}
	
	function parseStatus(headerArray, msgObj) {
		var splitValue;
		
		// We only expect Status headers on REPORT requests.  Ignore the header
		// if we find it on a response.
		if (msgObj instanceof CrocMSRP.Message.Response) {
			console.log('Ignoring Status header on response');
			return true;
		}
		
		// We only expect one Status header
		if (headerArray.length !== 1) {
			console.log('Multiple Status headers');
			return false;
		}
		
		splitValue = headerArray[0].split(' ');
		if (splitValue.length < 2 || splitValue.shift() !== '000') {
			console.log('Unexpected Status header: ' + headerArray[0]);
			return false;
		}
		
		msgObj.status = parseInt(splitValue.shift(), 10);
		msgObj.comment = splitValue.join(' ');
		
		return true;
	}
	
	function parseUsePath(headerArray, msgObj) {
		// We only expect one Use-Path header
		if (headerArray.length !== 1) {
			console.log('Multiple Use-Path headers');
			return false;
		}
		
		msgObj.usePath = headerArray[0].split(' ');
		if (msgObj.usePath.length < 1) {
			console.log('Unexpected Use-Path header: ' + headerArray[0]);
			return false;
		}
		
		return true;
	}
	
	function parseExpires(headerArray, msgObj) {
		// We only expect one Expires header
		if (headerArray.length !== 1) {
			console.log('Multiple Expires headers');
			return false;
		}
		
		msgObj.expires = parseInt(headerArray[0], 10);
		if (isNaN(msgObj.expires)) {
			console.log('Unexpected Expires header: ' + headerArray[0]);
			return false;
		}
		
		return true;
	}
	
	function parseContentDisposition(headerArray, msgObj) {
		var splitValue, index, splitParam;
		
		// We only expect MIME headers on SEND requests.  Ignore the header
		// if we find it on a response.
		if (msgObj instanceof CrocMSRP.Message.Response) {
			console.log('Ignoring Content-Disposition header on response');
			return true;
		}
		
		// We only expect one Content-Disposition header
		if (headerArray.length !== 1) {
			console.log('Multiple Content-Disposition headers');
			return false;
		}
		
		splitValue = headerArray[0].split(';');
		if (splitValue.length < 1) {
			console.log('Unexpected Content-Disposition header: ' + headerArray[0]);
			return false;
		}
		
		msgObj.contentDisposition = {};
		msgObj.contentDisposition.type = chomp(splitValue.shift());
		msgObj.contentDisposition.param = {};
		for (index in splitValue) {
			splitParam = splitValue[index].split('=');
			if (splitParam.length !== 2) {
				console.log('Unexpected Content-Disposition param: ' + splitValue[index]);
				return false;
			}
			
			msgObj.contentDisposition.param[chomp(splitParam[0])] = unq(chomp(splitParam[1]));
		}
		
		return true;
	}
	
	function parseMsgId(headerArray, msgObj) {
		// We only expect one Message-ID header
		if (headerArray.length !== 1) {
			console.log('Multiple Message-ID headers');
			return false;
		}
		
		msgObj.messageId = chomp(headerArray[0]);
		if (msgObj.messageId.length < 1) {
			console.log('Unexpected Message-ID header: ' + headerArray[0]);
			return false;
		}
		
		return true;
	}
	
	var headerParsers = {
		'Message-ID': parseMsgId,
		'Failure-Report': parseFailureReport,
		'Byte-Range': parseByteRange,
		'Status': parseStatus,
		'Content-Disposition': parseContentDisposition,
		'WWW-Authenticate': parseWwwAuthenticate,
		'Use-Path': parseUsePath,
		'Expires': parseExpires,
		'Min-Expires': parseExpires,
		'Max-Expires': parseExpires
	};
	
	function parseKnownHeaders(msgObj) {
		var header, parseFn;
		for (header in msgObj.headers) {
			parseFn = headerParsers[header];
			if (!parseFn) {
				// Ignore unknown headers
				continue;
			}
			
			if (!parseFn(msgObj.headers[header], msgObj)) {
				console.log('Parsing failed for header ' + header);
				return false;
			}
		}
		
		return true;
	}
	
	return CrocMSRP;
}(CrocMSRP || {}));


var CrocMSRP = (function(CrocMSRP) {
	var unixToNtpOffset = 2208988800;
	
	/**
	 * @namespace Shared utility functions
	 * @private
	 */
	CrocMSRP.util = {
		newUriAuthority: function() {
			// Create new URI Authority (used in local MSRP URI)
			// Use a random eight-character alphanumeric string.
			return Math.random().toString(36).substr(2,8) + '.invalid';
		},
		
		newSID: function() {
			// Create new Session ID (used in local MSRP URI)
			// RFC 4975 section 14.1 requires 80 bits of randomness
			// Use a random ten-character alphanumeric string.
			return Math.random().toString(36).substr(2,10);
		},
		
		newTID: function() {
			// Create new Transaction ID (used for delimiting individual chunks)
			// Use a random eight-character alphanumeric string.
			// Could be longer, but RFC4975 only requires 64-bits of randomness.
			return Math.random().toString(36).substr(2,8);
		},
		
		newMID: function() {
			// Create new Message ID (used to identify an individual message, which may be chunked)
			// RFC 4975 suggests a complicated way of ensuring uniqueness, but we're
			// being lazy.
			var now = new Date();
			return CrocMSRP.util.dateToNtpTime(now) + '.' + Math.random().toString(36).substr(2,8);
		},
		
		newFileTransferId: function() {
			// Create new File Transfer ID (see RFC 5547). This must uniquely
			// identify a file transfer within a session, and ideally should be
			// globally unique.
			var now = new Date();
			return CrocMSRP.util.dateToNtpTime(now) + '.' + Math.random().toString(36).substr(2);
		},
		
		normaliseHeader: function(name) {
			// Normalise the header capitalisation
			var parts = name.toLowerCase().split('-'),
				part,
				header = '';
				
			for (part in parts) {
				if (part !== '0') {
					header += '-';
				}
				header += parts[part].charAt(0).toUpperCase() + parts[part].substring(1);
			}
			
			switch(header) {
			case 'Www-Authenticate':
				return 'WWW-Authenticate';
			case 'Message-Id':
				return 'Message-ID';
			}
			
			return header;
		},
		
		isEmpty: function(map) {
			var property;
			for (property in map) {
				if (map.hasOwnProperty(property)) {
					return false;
				}
			}
			return true;
		},
		
		ntpTimeToDate: function(ntpTime) {
			return new Date((parseInt(ntpTime, 10) - unixToNtpOffset) * 1000);
		},
		
		dateToNtpTime: function(date) {
			return parseInt(date.getTime() / 1000, 10) + unixToNtpOffset;
		},
		
		/**
		 * Encodes a string as an SDP filename-string, as defined in RFC 5547.
		 * @param {String} str The string to encode.
		 * @returns {String} The encoded string.
		 */
		encodeSdpFileName: function(str) {
			return str.replace(/%/g, '%25')
				.replace(/\0/g, '%00')
				.replace(/\n/g, '%0A')
				.replace(/\r/g, '%0D')
				.replace(/"/g, '%22');
		},
	
		/**
		 * Decodes an SDP filename-string, as defined in RFC 5547.
		 * @param {String} str The string to decode.
		 * @returns {String} The decoded string.
		 */
		decodeSdpFileName: function(str) {
			return str.replace(/%00/g, '\0')
				.replace(/%0A/gi, '\n')
				.replace(/%0D/gi, '\r')
				.replace(/%22/g, '"')
				.replace(/%25/g, '%');
		},

		/**
		 * Encodes a string as a quoted-string, as defined in RFC 822.
		 * Note: does not support folding, as this is not used in MSRP.
		 * @param {String} str The string to encode.
		 * @returns {String} The encoded string.
		 */
		encodeQuotedString: function(str) {
			var chars = str.split(''), index;
			for (index in chars) {
				switch (chars[index]) {
				case '"':
				case '\r':
				case '\\':
					// These must be escaped as a quoted-pair
					chars[index] = '\\' + chars[index];
					break;
				}
			}
			return chars.join('');
		},
	
		/**
		 * Decodes a quoted-string, as defined in RFC 822.
		 * Note: does not support folding, as this is not used in MSRP.
		 * @param {String} str The string to decode.
		 * @returns {String} The decoded string.
		 */
		decodeQuotedString: function(str) {
			var chars = str.split(''), index, escaped = false;
			for (index in chars) {
				if (escaped) {
					// Always include this char as-is
					continue;
				}
				
				if (chars[index] === '\\') {
					escaped = true;
					delete chars[index];
				}
			}
			return chars.join('');
		}
	
	};
	
	return CrocMSRP;
}(CrocMSRP || {}));

