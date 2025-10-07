// public/js/my_applications.js
function copy(button) {
  const input = button.parentElement.querySelector('input');
  input.select();
  document.execCommand("copy");
  alert("URLをコピーしました！");
}
