
/**
 * Quick and dirty test class.
 * (c) 2018. Andras Kemeny <subpardaemon@gmail.com>
 * LICENCE: MIT
 * @constructor
 * @returns {spdnTester} 
 */
function spdnTester() {
    this.responses = [];
    this.descs = [];
    this.expected = [];
}
/**
 * Add a response.
 * @param {*} resp the response we've got
 * @param {*} [expects='N/A'] expected value (might be overridden by the .matchResponses() call)
 * @param {String} [desc='response #NN']
 * @returns {undefined}
 */
spdnTester.prototype.addResponse = function(resp,expects,desc) {
    if (typeof desc==='undefined') {
	desc = 'response #'+this.responses.length.toString();
    }
    if (typeof expects==='undefined') {
	expects = 'N/A';
    }
    this.responses.push(resp);
    this.expected.push(expects);
    this.descs.push(desc);
};
/**
 * Match the responses.
 * @param {Array} [expected=this.expected] either leave it out, or provide a full expected response set
 * @returns {Boolean}
 */
spdnTester.prototype.matchResponses = function(expected) {
    if (typeof expected==='undefined') {
	expected = spdnTest.expected;
    }
    var errnum = 0;
    for(var i=0;i<expected.length;i++) {
	if (typeof this.responses[i]==='undefined') {
	    console.error('mismatch at #'+i+' ('+this.descs[i]+'), expected: ',expected[i],', got no counterpart');
	    haderrors = true;
	    ++errnum;
	}
	else if (this.responses[i]!==expected[i]) {
	    console.error('mismatch at #'+i+' ('+this.descs[i]+'), expected: ',expected[i],', got: ',this.responses[i]);
	    ++errnum;
	}
	else {
	    console.info('test #'+i+' ('+this.descs[i]+') passed as expected: ',expected[i]);
	}
    }
    if (this.responses.length>expected.length) {
	console.error('mismatch: more responses than expected, superflous part:',this.responses.slice(expected.length));
	++errnum;
    }
    if (errnum>0) {
	console.error('test failed, '+errnum+' of '+expected.length+' tests failed');
	return false;
    } else {
	console.info('test succeeded');
	return true;
    }
};
/**
 * A sync blocking mechanism.
 * @param {Number} msecs number of milliseconds to block
 * @returns {undefined}
 */
spdnTester.prototype.blockSync = function(msecs) {
    var st = new Date().getTime(), et = null;
    do {
	et = new Date().getTime();
    } while((et-msecs)<=st);
};

/*
 * ----------------------------------------------------------------------------
 * ACTUAL TEST BEGINS HERE
 * ----------------------------------------------------------------------------
 */

var spdnTest = new spdnTester();
try {
    const packet = require('./index.js');
    var dump = {
	'CO':'test',
	'OR':'testsystem',
	'PL':{'one':1,'two':true},
	'OP':{
	    'RR':true,
	    'BU':true,
	    'TY':'RQ'
	}
    };
    var dumpjs = JSON.stringify(dump);
    var testpacket = new packet(dump);
    spdnTest.addResponse(testpacket.payload.two,true,'payload.two from packet init with shorthand props');
    spdnTest.addResponse(testpacket.options.type,'RQ','options.type');
    testpacket.reply({'one':2,'two':null});
    spdnTest.addResponse(testpacket.payload.one,2,'payload.one after reply');
    spdnTest.addResponse(testpacket.options.type,'RP','options.type after reply');
    testpacket = new packet(dumpjs);
    spdnTest.addResponse(testpacket.command,'test','packet from JSON, command');
    spdnTest.addResponse(testpacket.payload.two,true,'payload.two (JSON packet)');
    spdnTest.addResponse(testpacket.shouldBlockUI(),false,'shouldBlockUI() while not sending');
    testpacket._commdata['timeout'] = 2;
    testpacket.toState('sending');
    spdnTest.addResponse(testpacket.shouldBlockUI(),true,'shouldBlockUI() while sending');
    spdnTest.blockSync(1500);
    spdnTest.addResponse(testpacket.isTimedOut(),false,'isTimedOut() in 1.5s, with 2s timeout');
    spdnTest.blockSync(1500);
    spdnTest.addResponse(testpacket.isTimedOut(),true,'isTimedOut() in 3s, with 2s timeout');
    testpacket.toState('failed');
    spdnTest.addResponse(testpacket.isActive(),false,'isActive() after timeout');
    testpacket.ack();
    spdnTest.addResponse(testpacket.command,'ACK','packet after ack()');
    var payload = {'one':1,'two':true};
    testpacket = new packet({
	'command':'test2',
	'payload':payload,
	'options':
		{
		    'destroyafter':true
		}
    });
    payload.two = false;
    spdnTest.addResponse(testpacket.command,'test2','command, packet from normal properties');
    spdnTest.addResponse(testpacket.options.destroyafter,true,'options.destroyafter');
    spdnTest.addResponse(testpacket.payload.two,true,'test payload object decoupling');
}
catch(e) {
    spdnTest.addResponse(e,'a normal test run','exception in main');
}
if (spdnTest.matchResponses()===false) {
    process.exit(1);
} else {
    process.exit(0);
}
