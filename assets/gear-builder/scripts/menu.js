window.addEventListener("click", function(e) {
  var menuoptions = $(e.target).find('.menu-options');

    if ($(e.target).hasClass("menu")) {
      if ($(menuoptions).css("display")  == "none") {
          $(menuoptions).css("display", "block");
      }
      else {
          $(menuoptions).css("display", "none");
      }
    }
    else {$('.menu-options').css("display", "none")}
});
