/**
 * 사이트 배경음악 (YouTube 임베드)
 * music.json 의 youtubeUrl 만 채우면 동작합니다.
 *
 * 자동재생 없이, 오른쪽 아래 재생 버튼을 누르면 그 자리에서 노래가 나옵니다.
 * 재생 중에 다른 페이지로 이동하면 이어서 재생됩니다.
 */
(function () {
  "use strict";

  var TIME_KEY = "bahno-music-time";
  var PLAYING_KEY = "bahno-music-playing";

  var config = null;
  var player = null;
  var playerReady = false;
  var videoId = "";
  var toggleEl = null;
  var playing = false;
  var pendingPlay = false;

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

  function sessionGet(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function sessionSet(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch (e) {}
  }

  function savedTime() {
    var t = Number.parseFloat(sessionGet(TIME_KEY) || "");
    return Number.isFinite(t) && t > 0 ? t : config.startAt || 0;
  }

  function saveTime() {
    if (!playerReady || typeof player.getCurrentTime !== "function") return;
    try {
      sessionSet(TIME_KEY, String(player.getCurrentTime()));
    } catch (e) {}
  }

  function renderToggle() {
    if (!toggleEl) return;
    toggleEl.innerHTML = playing
      ? '<svg class="music-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>'
      : '<svg class="music-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    toggleEl.classList.toggle("is-on", playing);
    var label = playing ? "음악 일시정지" : "음악 재생";
    toggleEl.setAttribute("aria-label", label);
    toggleEl.title = config.title ? config.title + " — " + label : label;
  }

  function play() {
    if (!playerReady) {
      pendingPlay = true;
      loadYouTubeApi();
      playing = true;
      renderToggle();
      return;
    }
    try {
      player.unMute();
      player.setVolume(config.volume);
      player.playVideo();
    } catch (e) {}
    playing = true;
    sessionSet(PLAYING_KEY, "1");
    renderToggle();
  }

  function pause() {
    if (playerReady) {
      try {
        player.pauseVideo();
      } catch (e) {}
      saveTime();
    }
    playing = false;
    pendingPlay = false;
    sessionSet(PLAYING_KEY, "0");
    renderToggle();
  }

  function buildToggle() {
    toggleEl = document.createElement("button");
    toggleEl.type = "button";
    toggleEl.className = "music-toggle";
    toggleEl.addEventListener("click", function () {
      if (playing) {
        pause();
      } else {
        play();
      }
    });
    document.body.appendChild(toggleEl);
    renderToggle();
  }

  function onPlayerReady() {
    playerReady = true;
    try {
      player.setVolume(config.volume);
      player.seekTo(savedTime(), true);
    } catch (e) {}
    if (pendingPlay) {
      pendingPlay = false;
      play();
    }
  }

  function onPlayerStateChange(event) {
    if (event.data === 0 && config.loop) {
      // 곡이 끝나면 처음부터 반복
      try {
        player.seekTo(config.startAt || 0, true);
        player.playVideo();
      } catch (e) {}
      return;
    }
    if (event.data === 1) {
      playing = true;
      renderToggle();
    } else if (event.data === 2) {
      playing = false;
      renderToggle();
    }
  }

  function createPlayer() {
    var mount = document.createElement("div");
    mount.className = "music-frame";
    mount.id = "bahno-music-frame";
    document.body.appendChild(mount);

    var playerVars = {
      controls: 0,
      disablekb: 1,
      fs: 0,
      modestbranding: 1,
      playsinline: 1,
      rel: 0,
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

  var apiRequested = false;

  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) {
      if (!player) createPlayer();
      return;
    }
    if (apiRequested) return;
    apiRequested = true;
    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof prev === "function") prev();
      createPlayer();
    };
    var script = document.createElement("script");
    script.id = "youtube-iframe-api";
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
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

      buildToggle();

      window.setInterval(saveTime, 1000);
      window.addEventListener("pagehide", saveTime);

      // 재생 중에 페이지를 이동한 경우 이어서 재생
      if (sessionGet(PLAYING_KEY) === "1") {
        play();
      }
    })
    .catch(function () {});
})();
