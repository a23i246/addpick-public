const emailInput = document.getElementById("emailInput");
const messageBox = document.getElementById("message");

function showMessage(msg, type) {
  messageBox.textContent = msg;
  messageBox.className =
    "message-box " +
    (type === "success" ? "success-message" : "error-message");
  messageBox.style.display = "block";
}

document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    // 入力値とCSRFトークンを取得
    const email = emailInput.value;
    const csrf = document.querySelector("input[name='_csrf']").value;

    // JSONで送信
    const res = await fetch("/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, _csrf: csrf }),
      credentials: "same-origin" // 👈 CSRF対策でクッキーを送信
    });

    const data = await res.json();
    if (data.success) {
      showMessage("確認メールを送信しました！", "success");
    } else {
      showMessage(data.error || "不明なエラー", "error");
    }
  } catch (err) {
    showMessage("通信エラー: " + err.message, "error");
  }
});
