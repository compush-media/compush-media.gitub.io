const FIDELAVIS={
default:{nom:"Fidelavis",couleur:"#C6A667",logo:"/assets/logos/default.png",avis:"#",tel:"#"},
restaurants:{
voltaire:{nom:"Le Voltaire",couleur:"#B48C4A",logo:"/assets/logos/voltaire.png",avis:"https://google.com",tel:"tel:+33123456789"}
}
};
function slug(){const p=location.pathname.split("/").filter(Boolean);return p[0]||null}
const data=FIDELAVIS.restaurants[slug()]||FIDELAVIS.default;
document.addEventListener("DOMContentLoaded",()=>{
document.documentElement.style.setProperty("--brand",data.couleur);
document.getElementById("logo")&&(document.getElementById("logo").src=data.logo);
document.getElementById("resto-name")&&(document.getElementById("resto-name").textContent=data.nom);
document.getElementById("btn-avis")&&(document.getElementById("btn-avis").href=data.avis);
document.getElementById("btn-call")&&(document.getElementById("btn-call").href=data.tel);
});
