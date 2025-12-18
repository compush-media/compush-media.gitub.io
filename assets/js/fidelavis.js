const redirectedPath = sessionStorage.redirect;
if (redirectedPath) {
  sessionStorage.removeItem("redirect");
  history.replaceState(null, "", redirectedPath);
}

const FIDELAVIS = {
  default: {
    nom: "Fidelavis",
    couleur: "#C6A667",
    logo: "/assets/logos/default.png"
  },
  restaurants: {
    voltaire: {
      nom: "Le Voltaire",
      couleur: "#C6A667",
      logo: "/assets/logos/voltaire.png"
    },
    resto1: {
      nom: "Resto 1",
      couleur: "#B6152B",
      logo: "/assets/logos/resto1.png"
    }
  }
};

function getRestaurantFromURL() {
  const path = window.location.pathname.replace(/^\/|\/$/g, "");
  return path || "app";
}

const slug = getRestaurantFromURL();
const data = FIDELAVIS.restaurants[slug] || FIDELAVIS.default;

document.addEventListener("DOMContentLoaded", () => {
  document.documentElement.style.setProperty("--brand", data.couleur);
  document.getElementById("restaurant-name").textContent = data.nom;
  const logo = document.getElementById("logo");
  logo.src = data.logo;
  logo.alt = data.nom;
});
