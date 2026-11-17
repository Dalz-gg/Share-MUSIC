/* Share MUSIC — extension points shared by app.js and feature modules.
   Loaded first so modules can register at top level. */
var Hooks = window.Hooks || {
  routes: [],   // fn(path, hash) -> true if the module rendered the page
  actions: [],  // fn(act, el, ev) -> true if the module handled the click
  notif: {},    // type -> fn(n, who, t) -> message HTML for the notifications page
  notifLink: {},// type -> fn(n) -> URL to open
  song: [],     // fn(so, view) after the recommended-song page is drawn (slots: #song-moment, #song-reacts, #song-spread)
  profile: [],  // fn(id, { isMe }) after a profile / my page is drawn (slot: #prof-extra)
  home: [],     // fn() after home is drawn
  renderHome: null, // a module may replace the whole home page: fn() -> void
};
window.Hooks = Hooks;
