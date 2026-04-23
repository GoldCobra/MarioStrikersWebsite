$(document).ready(function() {
  $('.tab-link').click(function() {
    var panelid = $(this).attr('aria-controls');
    var panel = document.getElementById(panelid);
    $(panel).removeClass('hidden').siblings().addClass('hidden');
    $('.tab-link').attr('aria-selected', false);
    $(this).attr('aria-selected', true).siblings().attr('aria-selected', false);
 });
})
