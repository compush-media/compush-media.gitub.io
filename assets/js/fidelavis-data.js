// FIDELAVIS CENTRAL CONFIG
const FIDELAVIS = {
  voltaire: {
    nom: "Le Voltaire",
    couleur: "#B48C4A",
    tel: "01 43 33 22 11",
    email: "contact@voltaire.fr",
    adresse: "5 rue des Morand, Neuilly-Plaisance",
    horaires: "Lun–Dim : 11h – 22h",
    instagram: "https://instagram.com/voltaire",
    facebook: "https://facebook.com/voltaire",
    avisLink: "https://search.google.com/local/writereview?placeid=ChIJ6-iH2gBl5kcR_8dVpV-kiCE",
    avisQR: "https://storage.googleapis.com/msgsndr/jpliF4UmGdEH0PBGE1Um/media/68b43a06ba67b31819ae53c9.png"
  }
};

function getResto() {
  const path = location.pathname.replace(/^\/|\/$/g, "");
  return path.split("/")[0] || "voltaire";
}

const RESTO = getResto();
const DATA = FIDELAVIS[RESTO] || FIDELAVIS["voltaire"];
