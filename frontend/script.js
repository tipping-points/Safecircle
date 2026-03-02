const devices = [
  { id: 1, name: "Iphone 17 Pro", activeAgo: "20 min ago", battery: "50%", distance: "2 Km" },
  { id: 2, name: "Macbook Pro", activeAgo: "58 min ago", battery: "43%", distance: "1 Km" },
  { id: 3, name: "ZTE Phone", activeAgo: "23 min ago", battery: "77%", distance: "2 Km" },
  { id: 4, name: "Motorola", activeAgo: "11 min ago", battery: "22%", distance: "4 Km" },
];

const grid = document.getElementById("device-grid");
const cardTemplate = document.getElementById("device-card-template");
const screens = {
  home: document.querySelector('[data-screen="home"]'),
  map: document.querySelector('[data-screen="map"]'),
};

const routeScreen = screens.map;
const sheetName = document.getElementById("sheet-name");
const sheetStatus = document.getElementById("sheet-status");
const sheetBattery = document.getElementById("sheet-battery");
const sheetDistance = document.getElementById("sheet-distance");
const trackerRadius = document.getElementById("tracker-radius");
const trackerBadge = document.getElementById("tracker-badge");
const backButton = document.getElementById("back-button");

function getRadiusClass(distance) {
  const numericDistance = Number.parseFloat(distance);

  if (numericDistance <= 1) return "radius--sm";
  if (numericDistance <= 2) return "radius--md";
  if (numericDistance <= 3) return "radius--lg";
  return "radius--xl";
}

function setScreen(screenName) {
  Object.entries(screens).forEach(([name, node]) => {
    const isActive = name === screenName;
    node.classList.toggle("is-active", isActive);
    node.setAttribute("aria-hidden", String(!isActive));
  });
}

function openTracking(device) {
  sheetName.textContent = device.name;
  sheetStatus.textContent = `Active ${device.activeAgo}`;
  sheetBattery.textContent = device.battery;
  sheetDistance.textContent = device.distance;
  trackerBadge.textContent = `Radius ${device.distance}`;
  trackerRadius.className = `tracker__radius ${getRadiusClass(device.distance)}`;
  routeScreen.classList.remove("is-route-animated");
  void routeScreen.offsetWidth;
  routeScreen.classList.add("is-route-animated");
  setScreen("map");
}

devices.forEach((device, index) => {
  const fragment = cardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".device-card");
  const cardOpen = fragment.querySelector(".device-card__open");
  const arrow = fragment.querySelector(".device-card__arrow");

  fragment.querySelector(".device-card__name").textContent = device.name;
  fragment.querySelector(".device-card__activity").textContent = `Active ${device.activeAgo}`;
  fragment.querySelector(".meta--battery").textContent = device.battery;
  fragment.querySelector(".meta--distance").textContent = device.distance;

  card.style.animation = `fade-up 340ms ease ${index * 90}ms both`;
  cardOpen.addEventListener("click", () => openTracking(device));
  arrow.addEventListener("click", () => openTracking(device));

  grid.appendChild(fragment);
});

backButton.addEventListener("click", () => setScreen("home"));
