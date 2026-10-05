(function(){
  function add(src){
    const s=document.createElement("script");
    s.src=src;
    s.async=false;
    document.head.appendChild(s);
  }
  add("https://telegram.org/js/telegram-web-app.js");
  add("/phantom-sign.js");
  add("/phantom-auth.js");
})();