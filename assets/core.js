function trackEvent(eventName, restoName, extra = {}) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "https://script.google.com/macros/s/AKfycbzrmSA6V4c4WxNRmzBAb_RLEMHZhfUeoqb_3yY3QXnrlJkaGPK5c6GF1z-hyA_uVDsj/exec";
  form.target = "stats_iframe";
  form.style.display = "none";

  let iframe = document.getElementById("stats_iframe");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.name = "stats_iframe";
    iframe.id = "stats_iframe";
    iframe.style.display = "none";
    document.body.appendChild(iframe);
  }

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "data";
  input.value = JSON.stringify({
    resto: restoName,
    event: eventName,
    mois: new Date().getMonth() + 1,
    annee: new Date().getFullYear(),
    user: localStorage.getItem("user_email") || "",
    userAgent: navigator.userAgent,
    pageURL: location.href,
    demo: extra.demo ?? "",
    deviceId: extra.deviceId ?? localStorage.getItem("device_id") || "",
    sessionId: extra.sessionId ?? sessionStorage.getItem("session_id") || "",
    src: extra.src ?? ""
  });

  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();

  setTimeout(() => form.remove(), 1000);
}
