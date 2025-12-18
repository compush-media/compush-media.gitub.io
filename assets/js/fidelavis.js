const FIDELAVIS = {
  default: {
    nom: "Fidelavis",
    couleur: "#C6A667",
    logo: "/assets/logos/default.png",
    formAvis: "",
    formPhoto: "",
    appsScript: "",
    tel: "",
    googleReview: ""
  },

  restaurants: {
    exemple: {
      nom: "resto1",
      couleur: "#C6A667",
      logo: "/assets/logos/exemple.png",
      formAvis: "",
      formPhoto: "",
      appsScript: "",
      tel: "",
      googleReview: ""
    }
  }
};

function getSubdomain() {
  const host = location.hostname.replace("www.", "");
  const parts = host.split(".");
  return parts.length > 2 ? parts[0] : "app";
}

const sub = getSubdomain();
const data = FIDELAVIS.restaurants[sub] || FIDELAVIS.default;

document.addEventListener("DOMContentLoaded", () => {
  document.documentElement.style.setProperty("--brand", data.couleur);

  if (document.getElementById("logo")) {
    logo.src = data.logo;
  }
  if (document.getElementById("restaurant-name")) {
    restaurant-name.textContent = data.nom;
  }
  if (document.getElementById("btn-tel") && data.tel) {
    btn-tel.href = "tel:" + data.tel;
  }
  if (document.getElementById("btn-avis") && data.googleReview) {
    btn-avis.href = data.googleReview;
  }
  if (document.getElementById("ghl-form") && data.formAvis) {
    ghl-form.src = data.formAvis;
  }
});
