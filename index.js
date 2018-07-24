/**
 * swatk6/packetqueue
 * @version v1.0.0
 * @author Andras Kemeny
 * 
 * A packet queue manager with layer-agnostic features, uses @swatk6/packet.
 * 
 * LICENSE: MIT
 * (c) Andras Kemeny, subpardaemon@gmail.com
 */

/** @type {swatk6_packet} */
var swatk6_packet = require('./swatk6_packet.js');

function swatk6_packetqueue(opts) {
    this.options = {
	onsend: null,
	onabort: null,
	oncommand: null,
	onblockui: null,
	ontransmit: null,
	onfail: null,
	oncomplete: null,
	onmartian: null,
	interval: 500,
	timeout: 0,
	replytimeout: 0,
	retries: 0,
	retrywait: 0,
	immediate: true,
	issocket: false,
	softbrake: true,
	origin: 'unknown',
	logger: null
    };
    for (var n in opts) {
	if (typeof this.options[n] !== 'undefined') {
	    this.options[n] = opts[n];
	}
    }
    this.state = {
	uiblocked: false,
	sending: false,
	suspended: false
    };
    /** @type {swatk6_packet[]} */
    this.packetq = [];
    this.inttimer = null;
    this._runner();
}
swatk6_packetqueue.version = '1.0.0';
swatk6_packetqueue.prototype.brand = function(packet) {
    packet.seqid = this.options.origin+packet.seqid;
    return packet;
};
swatk6_packetqueue.prototype.toString = function() {
    var out = '';
    for(var i=0;i<this.packetq.length;i++) {
	out += 'state['+i.toString()+']: '+this.packetq[i]._commdata.sendstate+', seqid: '+this.packetq[i].seqid+', cmd: '+this.packetq[i].command+', last: '+this.packetq[i]._commdata.lastsent+', type: '+this.packetq[i].options.type+"\n";
    }
    return out;
};
swatk6_packetqueue.prototype.inspect = function() {
    this._log('info',this.toString());
};
/**
 * Send a packet from the queue.
 * @param {swatk6_packet} packet
 */
swatk6_packetqueue.prototype.send = function(packet) {
    if (typeof packet === 'string') {
	packet = new swatk6_packet(packet);
    }
    packet.origin = this.options.origin;
    packet._commdata.timeout = this.options.timeout;
    packet._commdata.replytimeout = this.options.replytimeout;
    packet._commdata.retries = this.options.retries;
    packet._commdata.retrywait = this.options.retrywait;
    packet.toState('queue');
    for (var i = 0; i < this.packetq.length; i++) {
	if (this.packetq[i] === packet) {
	    return;
	}
    }
    this.packetq.push(packet);
    if (this.options.immediate === true && this.state.suspended === false) {
	if (this.inttimer !== null) {
	    clearTimeout(this.inttimer);
	}
	this._runner();
    }
};
/**
 * Set packet to error state.
 * @param {swatk6_packet} packet
 */
swatk6_packetqueue.prototype.error = function(packet) {
    packet._commdata['_noerror'] = false;
    packet.toState('failed');
    this._callevent('fail',packet);
};
/**
 * Receive a packet for processing; handles ACK duties all by itself.
 * @param {swatk6_packet} packet
 * @param {*} [resplink=null] response link
 * @emits swatk6_packetqueue#complete
 * @emits swatk6_packetqueue#command
 */
swatk6_packetqueue.prototype.receive = function (packet, resplink) {
    if (typeof resplink === 'undefined') {
	resplink = null;
    }
    var i = null, evf = null, found = false,
	    /** @type {swatk6_packet} */
	    rp = null;
    if (typeof packet !== 'undefined' && packet !== null && typeof packet['cloneForSend'] === 'undefined') {
	packet = new swatk6_packet(packet);
    }
    if (typeof packet === 'object' && packet !== null && typeof packet.seqid !== 'undefined') {
	if (resplink !== null && packet._commdata.responselink === null) {
	    packet._commdata.responselink = resplink;
	}
	for (i = 0; i < this.packetq.length; i++) {
	    //the received packet must be a reply to one of our packets
	    if (this.packetq[i].seqid === packet['seqid'] && found === false) {
		found = true;
		try {
		    //this is an ack answer
		    if (packet.command === 'ACK' && this.packetq[i]._commdata.sendstate === 'sending') {
			if (this.packetq[i].requiresReply() === true) {
			    this.packetq[i].toState('replywait');
			} else {
			    evf = this.packetq[i].toState('completed');
			    if (evf[1] === true) {
				this._callevent('complete', this.packetq[i]);
			    }
			}
		    }
		    //this is a reply answer
		    else if (this.packetq[i]._commdata.sendstate === 'replywait' || (this.packetq[i]._commdata.sendstate === 'sending' && this.options.issocket === false && this.packetq[i].requiresReply() === true)) {
			this.packetq[i].addState();
			this.packetq[i].command = packet.command;
			this.packetq[i].target = packet.target;
			this.packetq[i].origin = packet.origin;
			this.packetq[i].status = packet.status;
			this.packetq[i].payload = packet.payload;
			this.packetq[i].sessionid = packet.sessionid;
			this.packetq[i].options.reply = packet.options.reply;
			this.packetq[i].options.destroyafter = packet.options.destroyafter;
			this.packetq[i].options.type = packet.options.type;
			this.packetq[i].options.layer = packet.options.layer;
			evf = this.packetq[i].toState('completed');
			if (evf[1] === true) {
			    this._callevent('complete', this.packetq[i]);
			}
			if (this.options.issocket === true) {
			    rp = packet.clone(true);
			    rp.ack();
			    this.send(rp);
			}
		    }
		    //otherwise it's a martian packet
		    else {
			this._log('error', 'martian packet: ' + packet.command + ', seqid: ' + packet.seqid + ', sendstate: ', this.packetq[i]._commdata.sendstate);
			this._callevent('martian', packet);
		    }
		} catch (e) {
		    this._log('error', 'exception raised in receive::reply', e);
		}
	    }
	}
	//this is a new command
	if (found === false) {
	    try {
		if (this.options.issocket === true || packet.requiresReply() === false) {
		    rp = packet.clone(true);
		    rp.ack();
		    this.send(rp);
		}
		if (packet.requiresReply() === true) {
		    this._callevent('command', packet).then(function (replypacket) {
			if (typeof replypacket==='undefined' || replypacket===null) {
			    replypacket = packet.clone(true);
			    replypacket.reply();
			}
			this.send(replypacket);
		    }.bind(this), function (errstr) {
			if (typeof errstr==='undefined' || errstr===null) {
			    errstr = 'UNKNOWN_ERROR';
			}
			this._log('error', 'error receive::newcommand_withreply', packet, errstr);
			packet.reply({error: errstr}, 'ERROR');
			this.send(packet);
		    }.bind(this)).catch(function(errstr) {
			if (typeof errstr==='undefined' || errstr===null) {
			    errstr = 'UNKNOWN_ERROR';
			}
			this._log('error', 'error receive::newcommand_withreply', packet, errstr);
			packet.reply({error: errstr}, 'ERROR');
			this.send(packet);
		    }.bind(this));
		} else {
		    packet.toState('completed');
		    this._callevent('command', packet).then(function () {
		    }.bind(this), function (e) {
			if (e !== null) {
			    this._log('error', 'error receive::newcommand_noreply', packet, e);
			}
		    }.bind(this));
		}
	    } catch (e) {
		this._log('error', 'exception raised in receive::newcommand', packet, e);
	    }
	}
    } else {
	this._log('error', 'invalid packet: ', packet);
    }
};
/**
 * Suspend the queue if issusp===true, or thaw the queue if issusp===false.
 * @param {Boolean} [issusp=true]
 */
swatk6_packetqueue.prototype.suspend = function(issusp) {
    issusp = issusp === true;
    if (issusp === true && this.state.suspended === false) {
	if (this.options.softbrake === true) {
	    this._brake('soft');
	} else {
	    this._brake('hard');
	}
	this.state.suspended = true;
    } else if (issusp === false && this.state.suspended === true) {
	this._brake('release');
	this.state.suspended = false;
	this._runner();
    }
};
/**
 * Shut down the queue; one-time only.
 */
swatk6_packetqueue.prototype.shutdown = function() {
    this.state.suspended = true;
    this._brake('park');
};
/**
 * Fire event <event>
 * @param {String} event
 * @param {*} data
 */
swatk6_packetqueue.prototype._callevent = function(event,data) {
    if (typeof this.options['on' + event] === 'function') {
	return this.options['on' + event].call(this, data);
    }
    return null;
};
/**
 * Cease or resume opeartions in this queue. Hard and park braking
 * will abort packets already underway, with park emitting a failure
 * event as well.
 * @param {String} btype one of 'soft', 'hard', 'park' or 'release'
 */
swatk6_packetqueue.prototype._brake = function(btype) {
    if (btype !== 'release') {
	if (this.inttimer !== null) {
	    clearTimeout(this.inttimer);
	}
    }
    var anyactive = false;
    var shouldblockui = false;
    for (var i = 0; i < this.packetq.length; i++) {
	if (btype === 'release' && this.packetq[i].isSuspended()) {
	    this.packetq[i].suspend(false);
	    anyactive = this.packetq[i].isActive();
	    shouldblockui = this.packetq[i].shouldBlockUI();
	} else if (btype !== 'release') {
	    if (this.packetq[i].isActive()) {
		anyactive = true;
		shouldblockui = this.packetq[i].shouldBlockUI();
		if (btype !== 'soft') {
		    this._callevent('abort', this.packetq[i]);
		}
	    }
	    if (!this.packetq[i].canBeRemoved()) {
		this.packetq[i]._commdata['_noerror'] = false;
		if (btype === 'park') {
		    this.error(this.packetq[i]);
		} else {
		    this.packetq[i].suspend();
		}
	    }
	}
    }
    var flip = btype !== 'release' ? true : false;
    if (shouldblockui === true && this.state.uiblocked === flip) {
	this.state.uiblocked = false === flip;
	this._callevent('blockui', false === flip);
    }
    if (anyactive === true && this.state.sending === flip) {
	this.state.sending = false === flip;
	this._callevent('transmit', false === flip);
    }
};
swatk6_packetqueue.prototype._mergestates = function(prev,next) {
    for (var i = 0; i < 3; i++) {
	if (next[i] !== null) {
	    prev[i] = next[i];
	}
    }
    return prev;
};
/**
 * @private
 * @emits swatk6_packetqueue#send
 * @emits swatk6_packetqueue#abort
 * @emits swatk6_packetqueue#fail
 * @emits swatk6_packetqueue#transmit
 * @emits swatk6_packetqueue#blockui
 */
swatk6_packetqueue.prototype._runner = function() {
    this.inttimer = null;
    if (this.state.suspended === false) {
	// sending, completed, failed events -- if one of them changes...
	var state = [null, null, null];
	var shouldblockui = false;
	var anyactive = false;
	var localstate = null;
	var newq = [];
	//try {
	for (var i = 0; i < this.packetq.length; i++) {
	    if (this.packetq[i].canBeSent() === true) {
		state = this._mergestates(state, this.packetq[i].toState('sending'));
		this._callevent('send', this.packetq[i]);
		if (this.packetq[i].command === 'ACK') {
		    this.packetq[i].toState('completed');
		}
	    } else if (this.packetq[i].isTimedOut() === true) {
		this._callevent('abort', this.packetq[i]);
		localstate = this.packetq[i].toState('timeout');
		if (localstate[2] === true) {
		    this._callevent('fail', this.packetq[i]);
		}
		state = this._mergestates(state, localstate);
	    }
	    if (this.packetq[i].canBeRemoved() === false) {
		newq.push(this.packetq[i]);
		if (this.packetq[i].shouldBlockUI() === true) {
		    shouldblockui = true;
		}
		if (this.packetq[i].isActive() === true) {
		    anyactive = true;
		}
	    }
	}
	this.packetq = newq;
	if (state[0] === true && this.state.sending === false) {
	    this.state.sending = true;
	    this._callevent('transmit', true);
	} else if (state[0] === false && this.state.sending === true) {
	    this.state.sending = false;
	    this._callevent('transmit', false);
	}
	if (shouldblockui === true && this.state.uiblocked === false) {
	    this.state.uiblocked = true;
	    this._callevent('blockui', true);
	} else if (shouldblockui === false && this.state.uiblocked === true) {
	    this.state.uiblocked = false;
	    this._callevent('blockui', false);
	}
	if (anyactive === true && this.state.sending === false) {
	    this.state.sending = true;
	    this._callevent('transmit', true);
	}
	if (anyactive === false && this.state.sending === true) {
	    this.state.sending = false;
	    this._callevent('transmit', false);
	}
	/*
	 } catch(e) {
	 console.error('exception in the runner,',e);
	 }
	 */
    }
    this.inttimer = setTimeout(this._runner.bind(this), this.options.interval);
};
/**
 * Logging abstractor, for swatk6_logger
 * @param {String} level
 * @param {...*} log message and items to log
 */
swatk6_packetqueue.prototype._log = function(level) {
    var params = new Array(arguments.length);
    for(var i = 0; i < params.length; ++i) {
        params[i] = arguments[i];
    }
    params[0] = 'PACKETQUEUE@'+this.options.origin;
    if (this.options.logger!==null) {
	this.options.logger[level].apply(this.options.logger,params);
    } else {
	console.log.apply(this,params);
    }
};


module.exports = swatk6_packetqueue;
