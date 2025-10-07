// public/js/ad_request_form.js
document.addEventListener("DOMContentLoaded", () => {
  const unitInput = document.getElementById('unit_price');
  const rewardInput = document.getElementById('reward');
  const deadlineInput = document.getElementById('deadline');
  const todayValue = document.getElementById('today').value;
  const display = document.getElementById('request_fee_display');

  if (unitInput && rewardInput) {
    unitInput.addEventListener('input', () => {
      rewardInput.value = unitInput.value;
    });
  }

  function calculateRequestFee() {
    const today = new Date(todayValue);
    if (!deadlineInput.value) {
      display.textContent = '5000';
      return;
    }
    const deadline = new Date(deadlineInput.value);
    const diffTime = deadline - today;
    const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
    const requestFee = 5000 + diffDays * 100;
    display.textContent = requestFee;
  }

  calculateRequestFee();
  deadlineInput.addEventListener('input', calculateRequestFee);
});
