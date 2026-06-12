// Minimal WHEP (WebRTC-HTTP Egress Protocol) player — receive-only.
// Standard handshake: POST our SDP offer to the WHEP endpoint, get an SDP
// answer back. Works with MediaMTX, Cloudflare Stream, Galène, etc.
//
// When you share your example endpoint I'll adjust headers/auth/ICE here if it
// needs anything beyond the vanilla handshake (e.g. a Bearer token).

export function createWhepPlayer(video, placeholder) {
  let pc = null;
  let resource = null; // WHEP resource URL for teardown (from Location header)

  async function play(url) {
    await stop();
    if (!url) return;

    pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.ontrack = (e) => {
      video.srcObject = e.streams[0];
      placeholder?.classList.add('hidden');
    };
    pc.onconnectionstatechange = () => {
      if (pc && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        placeholder?.classList.remove('hidden');
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer.sdp,
    });
    if (!res.ok) throw new Error(`WHEP ${res.status}`);
    resource = res.headers.get('Location') || null;
    const answer = await res.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  }

  async function stop() {
    if (resource) {
      // Best-effort: tell the server to tear down the session.
      try {
        const url = new URL(resource, location.href).href;
        await fetch(url, { method: 'DELETE' });
      } catch {
        /* ignore */
      }
      resource = null;
    }
    if (pc) {
      pc.close();
      pc = null;
    }
    if (video.srcObject) {
      video.srcObject.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    placeholder?.classList.remove('hidden');
  }

  return { play, stop };
}
