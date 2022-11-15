/*
 * main.js
 *
 * Copyright (C) 2020 - 2021 Alfred E. Heggestad
 */

'use strict';

const connectButton    = document.querySelector('button#connectButton');
const disconnectButton = document.querySelector('button#disconnectButton');
const audio            = document.querySelector('audio#audio');
const remoteVideo      = document.getElementById('remoteVideo');

connectButton.onclick     = connect_call;
disconnectButton.onclick  = disconnect_call;
disconnectButton.disabled = true;


let pc;           /* PeerConnection */
let localStream;  /* MediaStream */
let session_id;   /* String (Opaque, generated by Server) */
let b_offerer = false;  /* false: Send Offer, true: Send Answer */


const pc_configuration = {
	bundlePolicy: 'balanced',

	/* certificates */

	iceCandidatePoolSize: 0,

	iceServers: [],

	iceTransportPolicy: 'all',

	/* peerIdentity */
};

const gum_constraints = {
	audio: {
		echoCancellation: false
	},
	video: {
		width:640,
		height:480,
		framerate:30
	}
};


function send_candidate(json)
{
	var xhr = new XMLHttpRequest();
	const loc = self.location;

	xhr.open("PATCH", '' + loc + 'candidate', true);
	xhr.setRequestHeader("Content-Type", "application/json");
	xhr.setRequestHeader("Session-ID", session_id);

	xhr.onreadystatechange = function() {
		if (this.readyState === XMLHttpRequest.DONE &&
		    this.status !== 204) {

			console.warn("send candidate failed (%d %s)",
				     this.status, this.statusText);
		}
	}

	xhr.send(json);
}


function connect_call()
{
	connectButton.disabled = true;

	console.log("Connecting call");

	pc = new RTCPeerConnection(pc_configuration);

	pc.onicecandidate = (event) => {

		if (event.candidate) {
			const cand_json = JSON.stringify(event.candidate);

			send_candidate(cand_json);
		}
	};

	pc.onicecandidateerror = function(event) {

		console.warn("ICE Candidate Error: local-address=%s --> url=%s (%s %s)",
			    event.address, event.url,
			    event.errorCode, event.errorText);

		/*
		  alert("ICE Candidate Error: " +
		  event.errorCode + " " + event.errorText);
		*/
	}

	pc.ontrack = function(event) {

		const track = event.track;

		console.log("ontrack: got track: kind='%s'", track.kind);

		if (audio.srcObject !== event.streams[0]) {
			audio.srcObject = event.streams[0];
			console.log("ontrack: got audio stream");
		}

		if (remoteVideo.srcObject !== event.streams[0]) {
			remoteVideo.srcObject = event.streams[0];
			console.log("ontrack: got video stream");
		}
	};

	console.log("Requesting local stream");

	let safeUserMedia =	navigator.mediaDevices != undefined 
		? navigator.mediaDevices.getUserMedia(gum_constraints) 
		: new Promise((_, reject) => reject("navigator.mediaDevices is undefined"));

	safeUserMedia
		.then(function(stream) {

			// save the stream
			localStream = stream;

			// type: MediaStreamTrack
			const audioTracks = localStream.getAudioTracks();
			const videoTracks = localStream.getVideoTracks();

			if (audioTracks.length > 0) {
				console.log("Using Audio device: '%s'",
					    audioTracks[0].label);
			}
			if (videoTracks.length > 0) {
				console.log("Using Video device: '%s'",
					    videoTracks[0].label);
			}

			localStream.getTracks()
				.forEach(track => pc.addTrack(track, localStream));
		
		})
		.catch(function(error) {

			alert("Get User Media: " + error);
		})
		.then(function(stream) {
			disconnectButton.disabled = false;
			send_post_connect();
		});
}


/*
 * Send SDP offer to the Server
 */
function send_offer()
{
	console.log("send SDP offer");

	pc.createOffer()
	.then(function (desc) {
		console.log("got local description: %s", desc.type);

		pc.setLocalDescription(desc).then(() => {

			const sd = pc.localDescription;
			const json = JSON.stringify(sd);

			send_put_sdp(json);
		},
		function (error) {
			console.log("setLocalDescription: %s",
				    error.toString());
		});
	})
	.catch(function(error) {
	       console.warn("Failed to create session description: %s",
			   error.toString());
	});
}


/*
 * Send SDP Answer to the server
 */
function send_answer()
{
	console.log("send SDP answer");

	pc.createAnswer()
	.then(function (desc) {
		console.log("got local description: %s", desc.type);

		pc.setLocalDescription(desc).then(() => {

			const sd = pc.localDescription;
			const json = JSON.stringify(sd);

			send_put_sdp(json);
		},
		function (error) {
			console.log("setLocalDescription: %s",
				    error.toString());
		});
	})
	.catch(function(error) {
	       console.warn("Failed to create session description: %s",
			   error.toString());
	});
}


function handle_offer(body)
{
	console.log("handle offer");

	const descr = JSON.parse(body);

	console.log("remote description: type='%s'", descr.type);

	pc.setRemoteDescription(descr).then(() => {
		console.log('offer: set remote description -- success');

		// send answer
		send_answer();

	}, function (error) {
		console.warn("setRemoteDescription: %s",
			    error.toString());
		disconnect_call();
	});
}


/*
 * Create a new call
 */
function send_post_connect()
{
	var xhr = new XMLHttpRequest();
	const loc = self.location;

	console.log("send post connect: " + loc);

	xhr.open("POST", '' + loc + 'connect', true);

	xhr.onreadystatechange = function() {

		if (this.readyState === XMLHttpRequest.DONE &&
		    (this.status === 200 || this.status === 201)) {

			const sessid = xhr.getResponseHeader("Session-ID");

			console.log("connect: new session: '%s' (%d %s)",
				    sessid, this.status, this.statusText);

			/* Save the session ID */
			session_id = sessid;

			document.getElementById("session_id").innerHTML = "Session ID " + sessid;

			if (b_offerer)
				send_offer();
			else {
				handle_offer(xhr.response);
			}
		}
	}

	xhr.send();
}


function send_put_sdp(descr)
{
	var xhr = new XMLHttpRequest();
	const loc = self.location;

	console.log("send PUT sdp: " + loc);

	xhr.open("PUT", '' + loc + 'sdp', true);
	xhr.setRequestHeader("Content-Type", "application/json");
	xhr.setRequestHeader("Session-ID", session_id);

	xhr.onreadystatechange = function() {
		if (this.readyState === XMLHttpRequest.DONE &&
		    (this.status === 200 || this.status === 201)) {

			console.log("post sdp: (%d %s)", this.status, this.statusText);

			if (b_offerer) {

				const descr = JSON.parse(xhr.response);

				console.log("remote description: type='%s'", descr.type);

				pc.setRemoteDescription(descr).then(() => {
					console.log('set remote description -- success');
				}, function (error) {
					console.warn("setRemoteDescription: %s",
						    error.toString());
					disconnect_call();
				});
			}
		}
	}

	xhr.send(descr);
}


function disconnect_call()
{
	console.log("Disconnecting call");

	localStream?.getTracks().forEach(track => track.stop());

	if (pc) {
		pc.close();
		pc = null;
	}

	disconnectButton.disabled = true;
	connectButton.disabled = false;

	if (session_id) {
		// see draft-ietf-wish-whip-03
		var xhr = new XMLHttpRequest();
		xhr.open("DELETE", '' + self.location, true);
		xhr.setRequestHeader("Session-ID", session_id);
		xhr.send();
	}

	session_id = null;

	document.getElementById("session_id").innerHTML = "";
}
