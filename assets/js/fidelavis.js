const FIDELAVIS = {
  default: {
    nom: "Fidelavis",
    couleur: "#C6A667",
    logo: "/assets/logos/default.png",
    avis: "#",
    tel: "#"
  },
  restaurants: {
    voltaire: {
      nom: "Le Voltaire",
      couleur: "#B48C4A",
      logo: "/assets/logos/voltaire.png",
      avis: "https://google.com",
      tel: "tel:+33123456789"
    }
  }
};

function getSlug() {
  const path = location.pathname.replace(/^\/|\/$/g, "");
  return path.split("/")[0] || null;
}

const slug = getSlug();
const data = FIDELAVIS.restaurants[slug] || FIDELAVIS.default;

document.addEventListener("DOMContentLoaded", () => {
  document.documentElement.style.setProperty("--brand", data.couleur);
  document.getElementById("logo").src = data.logo;
  document.getElementById("resto-name").textContent = data.nom;
  document.getElementById("avis").href = data.avis;
  document.getElementById("call").href = data.tel;
});
