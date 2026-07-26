/**
 * 사이트 배경음악 (YouTube 임베드)
 * music.json 의 youtubeUrl 만 채우면 동작합니다.
 *
 * 브라우저는 소리 있는 자동재생을 막기 때문에, 먼저 소리와 함께 재생을 시도하고
 * 막히면 음소거 상태로 재생해 두었다가 첫 클릭/스크롤/키 입력에서 소리를 켭니다.
 */
(function () {
  "use strict";

  var TIME_KEY = "bahno-music-time";
  var OFF_KEY = "bahno-music-off";

  var config = null;
  var player = null;
  var videoId = "";
  var toggleEl = null;
  var soundOn = false;
  var userTurnedOff = false;
  var gestureArmed = false;
  var saveTimer = null;

  function readYouTubeId(url) {
    if (!url) return "";
    var patterns = [
      /[?&]v=([A-Za-z0-9_-]{11})/,
      /youtu\.be\/([A-Za-z0-9_-]{11})/,
      /\/embed\/([A-Za-z0-9_-]{11})/,
      /\/shorts\/([A-Za-z0-9_-]{11})/,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = url.match(patterns[i]);
      if (m) return m[1];
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(url.trim())) return url.trim();
    return "";
  }

  function storage(get, key, value) {
    try {
      if (get) return window.sessionStorage.getItem(key);
      window.sessionStorage.setItem(key, value);
    } catch (e) {}
    return null;
  }

  function persistedOff() {
    try {
      return window.localStorage.getItem(OFF_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function persistOff(off) {
    try {
      window.localStorage.setItem(OFF_KEY, off ? "1" : "0");
    } catch (e) {}
  }

  function savedTime() {
    var raw = storage(true, TIME_KEY);
    var t = raw ? Number.parseFloat(raw) : NaN;
    return Number.isFinite(t) && t > 0 ? t : config.startAt || 0;
  }

  function saveTime() {
    if (!player || typeof player.getCurrentTime !== "function") return;
    try {
      storage(false, TIME_KEY, String(player.getCurrentTime()));
    } catch (e) {}
  }

  function buildToggle() {
    toggleEl = document.createElement("button");
    toggleEl.type = "button";
    toggleEl.className = "music-toggle";
    toggleEl.addEventListener("click", function () {
      if (soundOn) {
        turnOff();
      } else {
        turnOn();
      }
    });
    document.body.appendChild(toggleEl);
    renderToggle();
  }

  function renderToggle() {
    if (!toggleEl) return;
    var label = soundOn ? "음악 끄기" : "음악 켜기";
    toggleEl.textContent = soundOn ? "♪" : "♪̸";
    toggleEl.classList.toggle("is-on", soundOn);
    toggleEl.setAttribute("aria-label", label);
    toggleEl.title = config.title ? config.title + " — " + label : label;
  }

  function turnOn() {
    if (!player) return;
    userTurnedOff = false;
    persistOff(false);
    try {
      player.unMute();
      player.setVolume(config.volume);
      player.playVideo();
    } catch (e) {}
    soundOn = true;
    renderToggle();
  }

  function turnOff() {
    if (!player) return;
    userTurnedOff = true;
    persistOff(true);
    try {
      player.mute();
      player.pauseVideo();
    } catch (e) {}
    soundOn = false;
    renderToggle();
  }

  /** 자동재생이 막혔을 때, 사용자의 첫 동작에서 소리를 켠다 */
  function armFirstGesture() {
    if (gestureArmed) return;
    gestureArmed = true;
    var events = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"];

    function onGesture() {
      events.forEach(function (name) {
        window.removeEventListener(name, onGesture);
      });
      if (!userTurnedOff) turnOn();
    }

    events.forEach(function (name) {
      window.addEventListener(name, onGesture, { once: true, passive: true });
    });
  }

  function onPlayerReady() {
    try {
      player.setVolume(config.volume);
      player.seekTo(savedTime(), true);
    } catch (e) {}

    if (userTurnedOff) {
      try {
        player.mute();
      } catch (e) {}
      renderToggle();
      return;
    }

    // 1) 소리와 함께 자동재생 시도
    try {
      player.unMute();
      player.playVideo();
    } catch (e) {}

    // 2) 막혔는지 확인 후, 음소거 재생 + 첫 동작에서 소리 켜기
    window.setTimeout(function () {
      var state = -1;
      try {
        state = player.getPlayerState();
      } catch (e) {}
      var playing = state === 1 || state === 3;
      var muted = true;
      try {
        muted = player.isMuted();
      } catch (e) {}

      if (playing && !muted) {
        soundOn = true;
        renderToggle();
        return;
      }

      try {
        player.mute();
        player.playVideo();
      } catch (e) {}
      soundOn = false;
      renderToggle();
      armFirstGesture();
    }, 1200);
  }

  function onPlayerStateChange(event) {
    // 반복 재생 (playlist 파라미터가 동작하지 않는 경우 대비)
    if (event.data === 0 && config.loop) {
      try {
        player.seekTo(config.startAt || 0, true);
        player.playVideo();
      } catch (e) {}
    }
  }

  function createPlayer() {
    var mount = document.createElement("div");
    mount.className = "music-frame";
    mount.id = "bahno-music-frame";
    document.body.appendChild(mount);

    var playerVars = {
      autoplay: 1,
      controls: 0,
      disablekb: 1,
      fs: 0,
      modestbranding: 1,
      playsinline: 1,
      rel: 0,
      start: Math.floor(config.startAt || 0),
    };
    if (config.loop) {
      playerVars.loop = 1;
      playerVars.playlist = videoId;
    }

    player = new window.YT.Player(mount.id, {
      videoId: videoId,
      playerVars: playerVars,
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
      },
    });
  }

  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) {
      createPlayer();
      return;
    }
    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof prev === "function") prev();
      createPlayer();
    };
    if (!document.getElementById("youtube-iframe-api")) {
      var script = document.createElement("script");
      script.id = "youtube-iframe-api";
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }
  }

  function start() {
    buildToggle();
    loadYouTubeApi();

    saveTimer = window.setInterval(saveTime, 1000);
    window.addEventListener("pagehide", saveTime);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") saveTime();
    });
  }

  fetch("music.json", { cache: "no-store" })
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (data) {
      if (!data || data.enabled === false) return;
      videoId = readYouTubeId(data.youtubeUrl || "");
      if (!videoId) return;

      config = {
        title: data.title || "",
        startAt: Number(data.startAt) || 0,
        volume: Number.isFinite(Number(data.volume)) ? Number(data.volume) : 30,
        loop: data.loop !== false,
      };
      userTurnedOff = persistedOff();
      start();
    })
    .catch(function () {});
})();
