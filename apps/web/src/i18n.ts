import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const LANG_KEY = "retropolis.lang";

const resources = {
  en: {
    translation: {
      app: {
        name: "Retropolis",
        tagline: "Retros your team will look forward to.",
      },
      home: {
        title: "Start a retro board",
        boardName: "Board name",
        boardNamePlaceholder: "Sprint 42 retro",
        template: "Template",
        create: "Create board",
        creating: "Creating…",
        createFailed: "Creating the board failed. Please try again.",
      },
      template: {
        "went-well": {
          name: "Classic — Went well / To improve / Actions",
          hint: "The universal default. Right for almost every sprint retro.",
        },
        "start-stop-continue": {
          name: "Start / Stop / Continue",
          hint: "Action-oriented and self-explanatory — great for new teams.",
        },
        "mad-sad-glad": {
          name: "Mad / Sad / Glad",
          hint: "Emotional check — good after a stressful sprint.",
        },
        "four-ls": {
          name: "4Ls — Liked / Learned / Lacked / Longed for",
          hint: "Rounded review with a learning focus, ideal at milestones.",
        },
        sailboat: {
          name: "Sailboat — Wind / Anchors / Rocks / Island",
          hint: "Visual metaphor for drivers, blockers, risks and goals.",
        },
        starfish: {
          name: "Starfish — Keep / Less / More / Stop / Start",
          hint: "Finer-grained dial-up/dial-down for experienced teams.",
        },
      },
      join: {
        title: "Join “{{board}}”",
        yourName: "Your name",
        submit: "Join",
      },
      lobby: {
        hint_one:
          "{{count}} person is here. Share the link — start the retro when everyone arrived.",
        hint_other:
          "{{count}} people are here. Share the link — start the retro when everyone arrived.",
      },
      board: {
        share: "Share link",
        copy: "Copy",
        copied: "Copied!",
        participants: "Who's here",
        facilitator: "Facilitator",
        you: "you",
        offline: "offline",
      },
      phase: {
        stepper: "Retro phases",
        lobby: "Lobby",
        checkin: "Check-in",
        write: "Write",
        present: "Present",
        vote: "Vote",
        discuss: "Discuss",
        close: "Close",
        done: "Done",
        next: "Next",
        startRetro: "Start retro",
      },
      ready: {
        imDone: "I'm done",
        done: "Done",
        count: "{{ready}}/{{total}} done",
      },
      timer: {
        pause: "Pause",
        resume: "Resume",
        stop: "Stop",
        paused: "paused",
        sound: "Timer sound",
      },
      note: {
        placeholder: "Write a note… (Enter to add)",
        add: "Add",
        edit: "Edit note",
        delete: "Delete note",
        save: "Save",
        cancel: "Cancel",
        ghostWriting: "{{name}} is writing…",
      },
      column: {
        addColumn: "Add column",
        add: "Add",
        namePlaceholder: "Column name",
        rename: "Rename column",
        delete: "Delete column",
        reallyDelete: "Really delete?",
      },
      done: {
        title: "Retro finished",
        body: "This board is archived and read-only.",
      },
      status: {
        connecting: "Connecting…",
        offline: "Connection lost — reconnecting…",
      },
      notFound: {
        title: "Board not found",
        body: "This board does not exist or has been deleted.",
        home: "Create a new board",
      },
    },
  },
  de: {
    translation: {
      app: {
        name: "Retropolis",
        tagline: "Retros, auf die sich dein Team freut.",
      },
      home: {
        title: "Retro-Board starten",
        boardName: "Name des Boards",
        boardNamePlaceholder: "Sprint-42-Retro",
        template: "Vorlage",
        create: "Board erstellen",
        creating: "Wird erstellt…",
        createFailed:
          "Das Board konnte nicht erstellt werden. Bitte versuch es erneut.",
      },
      template: {
        "went-well": {
          name: "Klassisch — Lief gut / Zu verbessern / Maßnahmen",
          hint: "Der universelle Standard. Passt für fast jede Sprint-Retro.",
        },
        "start-stop-continue": {
          name: "Anfangen / Aufhören / Weitermachen",
          hint: "Handlungsorientiert und selbsterklärend — super für neue Teams.",
        },
        "mad-sad-glad": {
          name: "Wütend / Traurig / Froh",
          hint: "Emotionaler Check — gut nach einem stressigen Sprint.",
        },
        "four-ls": {
          name: "4Ls — Gefallen / Gelernt / Gefehlt / Gewünscht",
          hint: "Ausgewogener Rückblick mit Lernfokus, ideal bei Meilensteinen.",
        },
        sailboat: {
          name: "Segelboot — Wind / Anker / Felsen / Insel",
          hint: "Visuelle Metapher für Antrieb, Bremsen, Risiken und Ziele.",
        },
        starfish: {
          name: "Seestern — Beibehalten / Weniger / Mehr / Aufhören / Anfangen",
          hint: "Feinere Justierung für erfahrene Teams.",
        },
      },
      join: {
        title: "„{{board}}“ beitreten",
        yourName: "Dein Name",
        submit: "Beitreten",
      },
      lobby: {
        hint_one:
          "{{count}} Person ist da. Teile den Link — starte die Retro, wenn alle da sind.",
        hint_other:
          "{{count}} Personen sind da. Teile den Link — starte die Retro, wenn alle da sind.",
      },
      board: {
        share: "Link teilen",
        copy: "Kopieren",
        copied: "Kopiert!",
        participants: "Wer ist da",
        facilitator: "Moderation",
        you: "du",
        offline: "offline",
      },
      phase: {
        stepper: "Retro-Phasen",
        lobby: "Lobby",
        checkin: "Check-in",
        write: "Schreiben",
        present: "Vorstellen",
        vote: "Abstimmen",
        discuss: "Diskutieren",
        close: "Abschluss",
        done: "Fertig",
        next: "Weiter",
        startRetro: "Retro starten",
      },
      ready: {
        imDone: "Ich bin fertig",
        done: "Fertig",
        count: "{{ready}}/{{total}} fertig",
      },
      timer: {
        pause: "Pause",
        resume: "Weiter",
        stop: "Stopp",
        paused: "pausiert",
        sound: "Timer-Ton",
      },
      note: {
        placeholder: "Notiz schreiben… (Enter zum Hinzufügen)",
        add: "Hinzufügen",
        edit: "Notiz bearbeiten",
        delete: "Notiz löschen",
        save: "Speichern",
        cancel: "Abbrechen",
        ghostWriting: "{{name}} schreibt…",
      },
      column: {
        addColumn: "Spalte hinzufügen",
        add: "Hinzufügen",
        namePlaceholder: "Name der Spalte",
        rename: "Spalte umbenennen",
        delete: "Spalte löschen",
        reallyDelete: "Wirklich löschen?",
      },
      done: {
        title: "Retro abgeschlossen",
        body: "Dieses Board ist archiviert und schreibgeschützt.",
      },
      status: {
        connecting: "Verbinde…",
        offline: "Verbindung verloren – verbinde neu…",
      },
      notFound: {
        title: "Board nicht gefunden",
        body: "Dieses Board existiert nicht oder wurde gelöscht.",
        home: "Neues Board erstellen",
      },
    },
  },
} as const;

// Runs at module evaluation — storage-blocked contexts (hardened profiles,
// third-party iframes) throw on localStorage access and must not blank the app.
function initialLanguage(): "de" | "en" {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === "de" || stored === "en") return stored;
  } catch {
    // fall through to the navigator language
  }
  return navigator.language.toLowerCase().startsWith("de") ? "de" : "en";
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: "de" | "en"): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // storage unavailable — the choice just won't persist
  }
  void i18n.changeLanguage(lang);
}

export default i18n;
