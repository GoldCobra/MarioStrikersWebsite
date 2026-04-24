window.addEventListener("click", function(e) {
      var flyoutElement = document.getElementById('myMultiselect');
      var checkboxes = document.getElementById("mySelectOptions");
      var displayValue = checkboxes.style.display;
  
        if (flyoutElement.contains(e.target)) return;
        if (displayValue === "block") checkboxes.style.display = "none";
    });
  
  function checkboxStatusChange() {
    var multiselect = document.getElementById("mySelectLabel");
    var multiselectOption = multiselect.getElementsByTagName('option')[0];
  
    var values = [];
    var checkboxes = document.getElementById("mySelectOptions");
    var checkedCheckboxes = checkboxes.querySelectorAll('input[type=checkbox]:checked');
  
    for (const item of checkedCheckboxes) {
      var checkboxValue = item.getAttribute('value');
      var dropdownLabel = checkboxValue === "Bowser Jr" ? "Bowser Jr." : checkboxValue;
      values.push(dropdownLabel);
    }
  
    var dropdownValue = "Select Character";
    if (values.length > 0 && values.length < 3) {
      dropdownValue = values.join(' & ');
    }
    if (values.length > 2 && values.length < 16) {
      dropdownValue = values.length + " Characters"
    }
    if (values.length > 15) {
      dropdownValue = "All Characters"
    }
  
    multiselectOption.innerText = dropdownValue;
  }
  
  function toggleCheckboxArea(onlyHide = false) {
    var checkboxes = document.getElementById("mySelectOptions");
    var displayValue = checkboxes.style.display;
  
    if (displayValue != "block") {
      if (onlyHide == false) {
        checkboxes.style.display = "block";
      }
    } else {
      checkboxes.style.display = "none";
    }
  }

$(document).ready(function() {
  $('#selectall').click(function() {
    let checkboxes = document.querySelectorAll('input[type=checkbox]');
    let state = checkboxes[0].checked;
    for(let i = 0; i < 17 ; i++) {
      checkboxes[i].checked = state;
    }

    $('.checkbox').click(function(){
        if($(".checkbox:checked").length === 16) { 
            $("#selectall").prop("checked", false);
        }else {
            $("#selectall").prop("checked", true);            
        }
    });
  })
})
