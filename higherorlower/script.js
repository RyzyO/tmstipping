const horses = [
  {
    name: "Winx",
    prizemoney: 26451174
  },
  {
    name: "Black Caviar",
    prizemoney: 7953936
  },
  {
    name: "Makybe Diva",
    prizemoney: 14526685
  },
  {
    name: "Nature Strip",
    prizemoney: 20755008
  },
  {
    name: "Verry Elleegant",
    prizemoney: 14865744
  },
  {
    name: "Sunline",
    prizemoney: 11351607
  },
  {
    name: "So You Think",
    prizemoney: 10749800
  },
  {
    name: "Lonhro",
    prizemoney: 5790510
  },
  {
    name: "Northerly",
    prizemoney: 9341850
  },
  {
    name: "Apache Cat",
    prizemoney: 4588700
  },
  {
    name: "Redzel",
    prizemoney: 16444000
  },
  {
    name: "Bella Nipotina",
    prizemoney: 22757625
  },
  {
    name: "Anamoe",
    prizemoney: 12128025
  },
  {
    name: "Weekend Hussler",
    prizemoney: 3096400
  },
  {
    name: "Buffering",
    prizemoney: 7294850
  },
  {
    name: "Chautauqua",
    prizemoney: 8821935
  },
  {
    name: "Takeover Target",
    prizemoney: 6028311
  },
  {
    name: "Efficient",
    prizemoney: 4788525
  },
  {
    name: "Preferment",
    prizemoney: 3432730
  },
  {
    name: "Might And Power",
    prizemoney: 5220890
  },
  {
    name: "Scenic Blast",
    prizemoney: 2123569
  },
  {
    name: "Sacred Choice",
    prizemoney: 2151890
  },
  {
    name: "Racing To Win",
    prizemoney: 3762285
  },
  {
    name: "Atlantic Jewel",
    prizemoney: 1587925
  },
  {
    name: "Dissident",
    prizemoney: 2021200
  },
  {
    name: "Pierro",
    prizemoney: 4536650
  },
  {
    name: "All Too Hard",
    prizemoney: 2288200
  },
  {
    name: "Happy Clapper",
    prizemoney: 7307800
  },
  {
    name: "Giga Kick",
    prizemoney: 9671200
  },
  {
    name: "Kolding",
    prizemoney: 6539900
  },
  {
    name: "Santa Ana Lane",
    prizemoney: 8216711
  },
  {
    name: "Melody Belle",
    prizemoney: 4224049
  },
  {
    name: "Hartnell",
    prizemoney: 7469499
  },
  {
    name: "Alligator Blood",
    prizemoney: 8106525
  },
  {
    name: "Incentivise",
    prizemoney: 5757300
  },
  {
    name: "Russian Camelot",
    prizemoney: 2348225
  },
  {
    name: "Think It Over",
    prizemoney: 8496570
  },
  {
    name: "Duais",
    prizemoney: 3145765
  },
  {
    name: "Fangirl",
    prizemoney: 10470115
  },
  {
    name: "Zaaki",
    prizemoney: 11026357
  },
  {
    name: "I'm Thunderstruck",
    prizemoney: 8326850
  },
  {
    name: "Mr Brightside",
    prizemoney: 18898547
  },
  {
    name: "Via Sistina",
    prizemoney: 19465126
  },
  {
    name: "Pride Of Jenni",
    prizemoney: 12517185
  },
  {
    name: "Joliestar",
    prizemoney: 4593575
  },
  {
    name: "Yulong Prince",
    prizemoney: 2073042
  },
  {
    name: "Alinghi",
    prizemoney: 3559367
  },
  {
    name: "Lankan Rupee",
    prizemoney: 4129510
  },
  {
    name: "Miss Andretti",
    prizemoney: 2848991
  },
  {
    name: "Elvstroem",
    prizemoney: 3565000
  }
];
const elements = {
  gameScreen: document.querySelector("#gameScreen"),
  gameOverScreen: document.querySelector("#gameOverScreen"),
  leftCard: document.querySelector("#leftCard"),
  rightCard: document.querySelector("#rightCard"),
  leftName: document.querySelector("#leftName"),
  leftMoney: document.querySelector("#leftMoney"),
  leftRecord: document.querySelector("#leftRecord"),
  rightName: document.querySelector("#rightName"),
  rightMoney: document.querySelector("#rightMoney"),
  rightRecord: document.querySelector("#rightRecord"),
  questionArea: document.querySelector("#questionArea"),
  answerArea: document.querySelector("#answerArea"),
  resultText: document.querySelector("#resultText"),
  higherBtn: document.querySelector("#higherBtn"),
  lowerBtn: document.querySelector("#lowerBtn"),
  streak: document.querySelector("#streak"),
  finalScore: document.querySelector("#finalScore"),
  bestScore: document.querySelector("#bestScore"),
  restartBtn: document.querySelector("#restartBtn"),
  shareBtn: document.querySelector("#shareBtn"),
  shareStatus: document.querySelector("#shareStatus")
};

let leftHorse;
let rightHorse;
let streak = 0;
let answering = false;

function randomHorse(excludeName = "") {
  const available = horses.filter(horse => horse.name !== excludeName);
  return available[Math.floor(Math.random() * available.length)];
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0
  }).format(value);
}

function setCard(card, horse) {
  card.style.backgroundImage = `url("${horse.image}")`;
}

function renderRound() {
  answering = false;
  elements.questionArea.classList.remove("hidden");
  elements.answerArea.classList.add("hidden");
  elements.higherBtn.disabled = false;
  elements.lowerBtn.disabled = false;
  elements.rightCard.classList.remove("correct-flash", "wrong-flash");

  elements.leftName.textContent = leftHorse.name;
  elements.leftMoney.textContent = formatMoney(leftHorse.prizemoney);
  elements.leftRecord.textContent = leftHorse.record;

  elements.rightName.textContent = rightHorse.name;
  elements.rightMoney.textContent = "";
  elements.rightRecord.textContent = rightHorse.record;
  elements.resultText.textContent = "";

  setCard(elements.leftCard, leftHorse);
  setCard(elements.rightCard, rightHorse);
  elements.streak.textContent = streak;
}

function startGame() {
  streak = 0;
  leftHorse = randomHorse();
  rightHorse = randomHorse(leftHorse.name);

  elements.gameOverScreen.classList.add("hidden");
  elements.gameOverScreen.classList.remove("flex");
  elements.gameScreen.classList.remove("hidden");

  renderRound();
}

function makeGuess(direction) {
  if (answering) return;
  answering = true;

  elements.higherBtn.disabled = true;
  elements.lowerBtn.disabled = true;
  elements.questionArea.classList.add("hidden");
  elements.answerArea.classList.remove("hidden");
  elements.rightMoney.textContent = formatMoney(rightHorse.prizemoney);

  const isHigher = rightHorse.prizemoney >= leftHorse.prizemoney;
  const isCorrect = direction === "higher" ? isHigher : !isHigher;

  if (isCorrect) {
    streak += 1;
    elements.streak.textContent = streak;
    elements.resultText.textContent = "Correct — keep racing!";
    elements.resultText.className = "mt-5 text-lg font-bold text-[#f2d675]";
    elements.rightCard.classList.add("correct-flash");

    window.setTimeout(() => {
      leftHorse = rightHorse;
      rightHorse = randomHorse(leftHorse.name);
      renderRound();
    }, 1500);
  } else {
    elements.resultText.textContent = "Incorrect";
    elements.resultText.className = "mt-5 text-lg font-bold text-red-300";
    elements.rightCard.classList.add("wrong-flash");

    window.setTimeout(showGameOver, 1500);
  }
}

function showGameOver() {
  const previousBest = Number(localStorage.getItem("racehorseHigherLowerBest") || 0);
  const best = Math.max(previousBest, streak);
  localStorage.setItem("racehorseHigherLowerBest", String(best));

  elements.finalScore.textContent = streak;
  elements.bestScore.textContent = `Best streak on this device: ${best}`;
  elements.shareStatus.textContent = "";
  elements.gameScreen.classList.add("hidden");
  elements.gameOverScreen.classList.remove("hidden");
  elements.gameOverScreen.classList.add("flex");
}


async function shareResult() {
  const shareText = `I scored a streak of ${streak} in Mock Sports Racehorse Higher or Lower! 🏇`;
  const shareData = {
    title: "Mock Sports — Racehorse Higher or Lower",
    text: shareText,
    url: window.location.href
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      elements.shareStatus.textContent = "Result shared.";
      return;
    }

    const fallbackText = `${shareText} ${window.location.href}`;
    await navigator.clipboard.writeText(fallbackText);
    elements.shareStatus.textContent = "Result copied to clipboard.";
  } catch (error) {
    if (error.name === "AbortError") return;

    try {
      const textArea = document.createElement("textarea");
      textArea.value = `${shareText} ${window.location.href}`;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      textArea.remove();
      elements.shareStatus.textContent = "Result copied to clipboard.";
    } catch {
      elements.shareStatus.textContent = "Sharing is not supported in this browser.";
    }
  }
}

elements.higherBtn.addEventListener("click", () => makeGuess("higher"));
elements.lowerBtn.addEventListener("click", () => makeGuess("lower"));
elements.restartBtn.addEventListener("click", startGame);
elements.shareBtn.addEventListener("click", shareResult);

startGame();
