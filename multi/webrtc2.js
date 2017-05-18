//-- Media Stream --//
let localVideo = document.getElementById('local_video');
let localStream = null;
let peerConnections = [];
let remoteStreams = [];
let remoteVideos = [];
const MAX_CONNECTION_COUNT = 3;

let container = document.getElementById('container');
_assert('container', container);

navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
RTCSessionDescription = window.RTCSessionDescription || window.webkitRTCSessionDescription || window.mozRTCSessionDescription;


//-- video elements start--//
function attachVideo(id, stream) {
    let video = addRemoteVideoElement(id);
    playVideo(video, stream);
    video.volume = 1.0;
}

function detachVideo(id) {
    let video = getRemoteVideoElement(id);
    pauseVideo(video);
    deleteRemoteVideoElement(id);
}

function isRemoteVideoAttached(id) {
    if (remoteVideos[id]) {
        return true;
    } else {
        return false;
    }
}

function getRemoteVideoElement(id) {
    let video = remoteVideos[id];
    _assert('getRemoteVideoElement() video must exist', video);
    return video;
}

function deleteRemoteVideoElement(id) {
    _assert('deleteRemoteVideoElement() stream must exist', remoteVideos[id]);
    removeVideoElement('remote_video_' + id);
    delete remoteVideos[id];
}

function createVideoElement(elementId) {
    let video = document.createElement('video');
    video.width = '480';
    video.height = '360';
    video.border = '1px solid black'
    video.id = elementId;
    video.style.border = 'solid black 1px';
    video.style.margin = '2px';
    container.appendChild(video);
    return video;
}

function removeVideoElement(elementId) {
    let video = document.getElementById(elementId);
    _assert('removeVideoElement() video must exist', video);
    container.removeChild(video);
    return video;
}

function ElementRequestFullscreen(element) {
    var list = [
        "requestFullscreen", "webkitRequestFullScreen", "mozRequestFullScreen", "msRequestFullscreen"
    ];
    var i;
    var num = list.length;
    for (i = 0; i < num; i++) {
        if (element[list[i]]) {
            element[list[i]]();
            return true;
        }
    }
    return false;
}
var element = document.getElementById("video");
element.onclick = function(e) {
    ElementRequestFullscreen(element);
};

//-- video elements end--//

//-- media handling --//
function startVideo() {
    getDeviceStream({
            video: true,
            audio: true
        }) // audio: false <-- ontrack once, audio:true --> ontrack twice!!
        //navigator.mediaDevices.getUserMedia({video: true, audio: true})
        .then(function(stream) { // success
            localStream = stream;
            playVideo(localVideo, stream);
        }).catch(function(error) { // error
            console.error('getUserMedia error:', error);
            return;
        });
}

function stopVideo() {
    pauseVideo(localVideo);
    stopLocalStream(localStream);
    localStream = null;
}

function stopLocalStream(stream) {
    let tracks = stream.getTracks();
    if (!tracks) {
        console.warn('NO tracks');
        return;
    }
    for (let track of tracks) {
        track.stop();
    }
}

function getDeviceStream(option) {
    if ('getUserMedia' in navigator.mediaDevices) {
        console.log('navigator.mediaDevices.getUserMedia');
        return navigator.mediaDevices.getUserMedia(option);
    } else {
        console.log('wrap navigator.getUserMedia with Promise');
        return new Promise(function(resolve, reject) {
            navigator.getUserMedia(option, resolve, reject);
        });
    }
}

function playVideo(element, stream) {
    if ('srcObject' in element) {
        element.srcObject = stream;
    } else {
        element.src = window.URL.createObjectURL(stream);
    }
    element.play();
    element.volume = 0;
}

function pauseVideo(element) {
    element.pause();
    if ('srcObject' in element) {
        element.srcObject = null;
    } else {
        if (element.src && (element.src !== '')) {
            window.URL.revokeObjectURL(element.src);
        }
        element.src = '';
    }
}

//-- hand Signaling --//
function sendSdp(id, sessionDescription) {
    console.log('---sending sdp ---');
    let message = { type: sessionDescription.type, sdp: sessionDescription.sdp };
    console.log('sending SDP=' + message);
    emitTo(id, message);
}

function sendIceCandiate(id, candidate) {
    console.log('--sending ICE candidate--');
    let obj = { type: 'candidate', ice: JSON.stringify(candidate) };
    emitTo(id, obj);
}

//-- connection handling --//
function prepareNewConnection(id) {
    let pc_config = { "iceServers": [{ "urls": "stun:stun.l.google.com:19302" }] };
    let peer = new RTCPeerConnection(pc_config);
    if ('ontrack' in peer) {
        peer.ontrack = function(event) {
            let stream = event.streams[0];
            console.log('-- peer.ontrack() stream.id=' + stream.id);
            if (isRemoteVideoAttached(id)) {
                console.log('stream already attached, so ignore');
            } else {
                attachVideo(id, stream);
            }
        };
    } else {
        peer.onaddstream = function(event) {
            let stream = event.stream;
            console.log('-- peer.onaddstream() stream.id=' + stream.id);
            attachVideo(id, stream);
        };
    }

    peer.onicecandidate = function(evt) {
        if (evt.candidate) {
            console.log(evt.candidate);

            // Trickle ICE の場合は、ICE candidateを相手に送る
            sendIceCandidate(id, evt.candidate);

            // Vanilla ICE の場合には、何もしない
        } else {
            console.log('empty ice event');

            // Trickle ICE の場合は、何もしない

            // Vanilla ICE の場合には、ICE candidateを含んだSDPを相手に送る
            //sendSdp(id, peer.localDescription);
        }
    };

    // --- when need to exchange SDP ---
    peer.onnegotiationneeded = function(evt) {
        console.log('-- onnegotiationneeded() ---');
    };

    // --- other events ----
    peer.onicecandidateerror = function(evt) {
        console.error('ICE candidate ERROR:', evt);
    };

    peer.onsignalingstatechange = function() {
        console.log('== signaling status=' + peer.signalingState);
    };
    peer.oniceconnectionstatechange = function() {
        console.log('== ice connection status=' + peer.iceConnectionState);
        if (peer.iceConnectionState === 'disconnected') {
            console.log('-- disconnected --');
            stopConnection(id);
        }
    };
    peer.onicegatheringstatechange = function() {
        console.log('==***== ice gathering state=' + peer.iceGatheringState);
    };
    peer.onconnectionstatechange = function() {
        console.log('==***== connection state=' + peer.connectionState);
    };
    peer.onremovestream = function(event) {
        console.log('-- peer.onremovestream()');
        deleteRemoteStream(id);
        detachVideo(id);
    };
    if (localStream) {
        console.log('Adding local stream...');
        peer.addStream(localStream);
    } else {
        console.warn('no local stream, but continue.');
    }

    return peer;
}

function makeOffer(id) {
    _assert('makeOffer must not connected yet', (!isConnectedWith(id)));
    peerConnection = prepareNewConnection(id);
    addConnection(id, peerConnection);

    peerConnection.createOffer()
        .then(function(sessionDescription) {
            console.log('createOffer() succsess in promise');
            return peerConnection.setLocalDescription(sessionDescription);
        }).then(function() {
            console.log('setLocalDescription() succsess in promise');

            // -- Trickle ICE の場合は、初期SDPを相手に送る -- 
            sendSdp(id, peerConnection.localDescription);

            // -- Vanilla ICE の場合には、まだSDPは送らない --
        }).catch(function(err) {
            console.error(err);
        });
}

function setOffer(id, sessionDescription) {
    /*
    if (peerConnection) {
        console.error('peerConnection alreay exist!');
    }
    */
    _assert('setOffer must not connected yet', (!isConnectedWith(id)));
    let peerConnection = prepareNewConnection(id);
    addConnection(id, peerConnection);

    peerConnection.setRemoteDescription(sessionDescription)
        .then(function() {
            console.log('setRemoteDescription(offer) succsess in promise');
            makeAnswer(id);
        }).catch(function(err) {
            console.error('setRemoteDescription(offer) ERROR: ', err);
        });
}

function makeAnswer(id) {
    console.log('sending Answer. Creating remote session description...');
    let peerConnection = getConnection(id);
    if (!peerConnection) {
        console.error('peerConnection NOT exist!');
        return;
    }

    peerConnection.createAnswer()
        .then(function(sessionDescription) {
            console.log('createAnswer() succsess in promise');
            return peerConnection.setLocalDescription(sessionDescription);
        }).then(function() {
            console.log('setLocalDescription() succsess in promise');

            // -- Trickle ICE の場合は、初期SDPを相手に送る -- 
            sendSdp(id, peerConnection.localDescription);

            // -- Vanilla ICE の場合には、まだSDPは送らない --
        }).catch(function(err) {
            console.error(err);
        });
}

function setAnswer(id, sessionDescription) {
    let peerConnection = getConnection(id);
    if (!peerConnection) {
        console.error('peerConnection NOT exist!');
        return;
    }

    peerConnection.setRemoteDescription(sessionDescription)
        .then(function() {
            console.log('setRemoteDescription(answer) succsess in promise');
        }).catch(function(err) {
            console.error('setRemoteDescription(answer) ERROR: ', err);
        });
}

//-- tricke ICE --//
function addIceCandidate(id, candidate) {
    let peerConnection = getConnection(id);
    if (peerConnection) {
        peerConnection.addIceCandidate(candidate);
    } else {
        console.error('PeerConnection not exist!');
        return;
    }
}

function connect() {
    if (!isReadyToConnect()) {
        console.warn('NOT READY to connect');
    } else if (!canConnectMore()) {
        console.log('TOO MANY connections');
    } else {
        callMe();
    }
}

function hangUp() {
    emitRoom({
        type: 'bye'
    });
    clearMessage(); // clear firebase
    stopAllConnection();
}

// ---- multi party --
function callMe() {
    emitRoom({
        type: 'call me'
    });
}


//-- use firebase --//
var config = {
    apiKey: "AIzaSyDO4f0oz84hozRESWKEy5_iqfkMiPmmDks",
    authDomain: "analytics-test-80947.firebaseapp.com",
    databaseURL: "https://analytics-test-80947.firebaseio.com",
    projectId: "analytics-test-80947",
    storageBucket: "analytics-test-80947.appspot.com",
    messagingSenderId: "574247415591"
};
firebase.initializeApp(config);

const dataDebugFlag = false;
let room = getRoomName();
let database = firebase.database();
let databaseRoot = 'nishi3lt/multi/';
let roomBroadcastRef;
let clientRef;
let clientId;

joinRoom(room);
serRoomLink(room);

function joinRoom(room) {
    console.log('join room name = ' + room);

    let key = database.ref(databaseRoot + room + '/_join_').push({
        joined: 'unknown'
    }).key
    clientId = 'member_' + key;
    console.log('joined to room=' + room + ' as clientId=' + clientId);
    database.ref(databaseRoot + room + '/_join_/' + key).update({
        joined: clientId
    });


    // remove join object
    if (!dataDebugFlag) {
        let jooinRef = database.ref(databaseRoot + room + '/_join_/' + key);
        jooinRef.remove();
    }

    roomBroadcastRef = database.ref(databaseRoot + room + '/_broadcast_');
    roomBroadcastRef.on('child_added', function(data) {
        console.log('roomBroadcastRef.on(data) data.key=' + data.key + ', data.val():', data.val());
        let message = data.val();
        let fromId = message.from;
        if (fromId === clientId) {
            // ignore self message
            return;
        }

        if (message.type === 'call me') {
            if (!isReadyToConnect()) {
                console.log('Not ready to connect, so ignore');
                return;
            } else if (!canConnectMore()) {
                console.warn('TOO MANY connections, so ignore');
            }

            if (isConnectedWith(fromId)) {
                // already connnected, so skip
                console.log('already connected, so ignore');
            } else {
                // connect new party
                makeOffer(fromId);
            }
        } else if (message.type === 'bye') {
            if (isConnectedWith(fromId)) {
                stopConnection(fromId);
            }
        }
    });

    clientRef = database.ref(databaseRoot + room + '/_direct_/' + clientId);
    clientRef.on('child_added', function(data) {
        console.log('clientRef.on(data)  data.key=' + data.key + ', data.val():', data.val());
        let message = data.val();
        let fromId = message.from;

        if (message.type === 'offer') {
            // -- got offer ---
            console.log('Received offer ... fromId=' + fromId);
            //let offer = message.sessionDescription;
            let offer = new RTCSessionDescription(message);
            setOffer(fromId, offer);
        } else if (message.type === 'answer') {
            // --- got answer ---
            console.log('Received answer ... fromId=' + fromId);
            //let answer = message.sessionDescription;
            let answer = new RTCSessionDescription(message);
            setAnswer(fromId, answer);
        } else if (message.type === 'candidate') {
            // --- got ICE candidate ---
            console.log('Received ICE candidate ... fromId=' + fromId);
            //let candidate = new RTCIceCandidate(message.ice);
            let candidate = new RTCIceCandidate(JSON.parse(message.ice)); // <---- JSON
            console.log(candidate);
            addIceCandidate(fromId, candidate);
        }

        if (!dataDebugFlag) {
            // remove direct message
            let messageRef = database.ref(databaseRoot + room + '/_direct_/' + clientId + '/' + data.key);
            messageRef.remove();
        }
    });
}

function setRoomLink(room) {
    let url = document.location.href;
    let anchorLink = document.getElementById('room_link');
    anchorLink.href = url;
    let anchorMail = document.getElementById('mail_link');
    let mailtoUrl = 'mailto:?subject=invitation-of-multi-party-videochat&body=' + url;
    anchorMail.href = mailtoUrl;
}

//-- use firebase --//

function emitRoom(msg) {
    msg.from = clientId;
    roomBroadcastRef.push(msg);
}

function emitTo(id, msg) {
    console.log('===== sending from=' + clientId + ' ,  to=' + id);
    msg.from = clientId;
    database.ref(databaseRoot + room + '/_direct_/' + id).push(msg);
}

function clearMessage() {
    clientRef.set({});
}

function getRoomName() {
    let url = document.location.href;
    let args = url.split('?');
    if (args.length > 1) {
        let room = args[1];
        if (room != '') {
            return room;
        }
    }
    let room = 'room_' + getUniqueStr();
    window.history.pushState(null, null, 'multi_firebase.html?' + room);
    return room;
}

function getUniqueStr(myStrong) {
    var strong = 1000;
    if (myStrong) strong = myStrong;
    return new Date().getTime().toString(16) + Math.floor(strong * Math.random()).toString(16);
}

function isReadyToConnect() {
    if (localStream) {
        return true;
    } else {
        return false;
    }
}

function getConnectionCount() {
    return peerConnections.length;
}

function canConnectMore() {
    return (getConnectionCount() < MAX_CONNECTION_COUNT);
}

function isConnectedWith(id) {
    if (peerConnections[id]) {
        return true;
    } else {
        return false;
    }
}

function addConnection(id, peer) {
    _assert('addConnection() peer', peer);
    _assert('addConnection() peer must NOT EXIST', (!peerConnections[id]));
    peerConnections[id] = peer;
}

function getConnection(id) {
    let peer = peerConnections[id];
    _assert('getConnection() peer must exist', peer);
    return peer;
}

function deleteConnection(id) {
    _assert('deleteConnection() peer must exist', peerConnections[id]);
    delete peerConnections[id];
}

function stopConnection(id) {
    detachVideo(id);
    if (isConnectedWith(id)) {
        let peer = getConnection(id);
        peer.close();
        deleteConnection(id);
    }
}

function stopAllConnection() {
    for (let id in peerConnections) {
        stopConnection(id);
    }
}

function addRemoteVideoElement(id) {
    _assert('addRemoteVideoElement() video must NOT EXIST', (!remoteVideos[id]));
    let video = createVideoElement('remote_video_' + id);
    remoteVideos[id] = video;
    return video;
}