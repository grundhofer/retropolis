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
      picker: {
        spin: "Spin the wheel",
        next: "Next person",
        finishRound: "Finish the round",
        presenting: "{{name}} is presenting",
        skip: "Skip",
        winner: "{{name}} is up!",
        everyone: "Everyone presented! 🎉",
        exclude: "Take {{name}} off the wheel",
      },
      group: {
        ungroup: "Unstack note",
      },
      vote: {
        yourVotes: "Your votes",
        remaining_one: "{{count}} vote left",
        remaining_other: "{{count}} votes left",
        meter: "{{done}}/{{total}} finished voting",
        settings: "Voting",
        votesPerPerson: "Votes per person",
        maxPerTarget: "Max per card",
        topN: "Top cards",
        apply: "Apply",
        plus: "Add a vote",
        minus: "Remove a vote",
      },
      discuss: {
        queue: "Discussion",
      },
      action: {
        title: "Action items",
        placeholder: "What are we going to do?",
        add: "Add",
        unassigned: "Unassigned",
        toggle: "Mark as done",
        delete: "Delete action",
        empty: "No action items yet — capture decisions while you discuss.",
      },
      kudos: {
        title: "Appreciation",
        subtitle: "End on positives — send a teammate some love.",
        empty: "No kudos yet. Be the first to appreciate someone!",
        to: "To",
        placeholder: "Say why (optional)…",
        send: "Send kudos",
        from: "— {{name}}",
        anonymous: "— anonymous",
        anonymousSend: "Send anonymously",
        someone: "someone",
        remove: "Remove kudo",
        card: {
          "thank-you": "Thank you",
          "great-job": "Great job",
          "well-done": "Well done",
          congratulations: "Congratulations",
          "totally-awesome": "Totally awesome",
        },
      },
      gif: {
        add: "GIF",
        search: "Search GIFs…",
        loading: "Searching…",
        none: "No GIFs found.",
        hint: "Type to search for a GIF.",
        unavailable: "GIF search isn't set up for this board.",
        remove: "Remove GIF",
        poweredBy: "Powered by KLIPY",
      },
      menu: {
        export: "Export",
        includeAuthors: "Include author names",
        settings: "Board settings",
        gifsEnabled: "Allow GIFs",
        retentionNotice: "Auto-deletes on {{date}}",
        retentionKept: "This board is kept (no auto-delete).",
        keep: "Keep",
        deleteNow: "Delete now",
        reallyDelete: "Really delete?",
      },
      roster: {
        makeFacilitator: "Make facilitator",
        removeFacilitator: "Remove facilitator",
        you: "(you)",
      },
      done: {
        title: "Retro finished",
        body: "This board is archived and read-only.",
      },
      deleted: {
        title: "Board deleted",
        body: "This retro board has been deleted.",
      },
      checkin: {
        icebreaker: "Check-in",
        noQuestion: "Warming up…",
        shuffle: "New question",
        primeDirectiveTitle: "The Prime Directive",
        primeDirective:
          "Regardless of what we discover, we understand and truly believe that everyone did the best job they could, given what they knew at the time, their skills and abilities, the resources available, and the situation at hand.",
        agreements: "Working agreements",
        agreementsDefault:
          "• Vegas rule — what's said here stays here\n• Attack problems, not people\n• One conversation at a time\n• Everyone's voice matters",
        edit: "Edit",
      },
      roti: {
        title: "Return on time invested",
        question: "Was this retro a good use of your time?",
        result: "Average {{average}} · {{count}} responses",
        pending: "{{count}} responses · average appears once 3 people answer",
        anonymous: "Anonymous — only the average is shared.",
      },
      icebreaker: {
        "one-word": "In one word, how did this sprint feel?",
        weather:
          "What's your weather report for this sprint? (sunny, stormy, foggy…)",
        "sprint-emoji": "Which emoji sums up your sprint?",
        "energy-level": "What's your energy level right now, 1 to 10?",
        highlight: "What was your highlight of the sprint?",
        learned: "What's one thing you learned recently?",
        superpower: "If you had one superpower this sprint, what would it be?",
        "movie-title": "If this sprint were a movie, what's its title?",
        song: "What song describes your week?",
        animal: "What animal matches your mood today?",
        "gif-week": "What GIF sums up your week?",
        grateful: "What are you grateful for this sprint?",
        surprise: "What surprised you this sprint?",
        "coffee-count": "How many coffees did this sprint take?",
        weekend: "What are you looking forward to this weekend?",
        "hidden-talent": "Share a hidden talent nobody here knows about.",
        "if-color": "What color is your mood today?",
        "proud-of": "What are you proud of from this sprint?",
        recharge: "How do you recharge after a tough sprint?",
        "one-wish": "One wish for the next sprint?",
        "team-word": "One word to describe the team this sprint?",
        "looking-forward": "What are you looking forward to next sprint?",
        "waffle-or-pancake": "Waffles or pancakes — and why does it matter?",
        "desert-island": "One tool you'd bring to a desert island?",
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
      picker: {
        spin: "Rad drehen",
        next: "Nächste Person",
        finishRound: "Runde abschließen",
        presenting: "{{name}} präsentiert",
        skip: "Überspringen",
        winner: "{{name}} ist dran!",
        everyone: "Alle haben präsentiert! 🎉",
        exclude: "{{name}} vom Rad nehmen",
      },
      group: {
        ungroup: "Aus Stapel lösen",
      },
      vote: {
        yourVotes: "Deine Stimmen",
        remaining_one: "{{count}} Stimme übrig",
        remaining_other: "{{count}} Stimmen übrig",
        meter: "{{done}}/{{total}} fertig abgestimmt",
        settings: "Abstimmung",
        votesPerPerson: "Stimmen pro Person",
        maxPerTarget: "Max. pro Karte",
        topN: "Top-Karten",
        apply: "Übernehmen",
        plus: "Stimme hinzufügen",
        minus: "Stimme entfernen",
      },
      discuss: {
        queue: "Diskussion",
      },
      action: {
        title: "Action Items",
        placeholder: "Was nehmen wir uns vor?",
        add: "Hinzufügen",
        unassigned: "Ohne Verantwortliche:n",
        toggle: "Als erledigt markieren",
        delete: "Action Item löschen",
        empty:
          "Noch keine Action Items — haltet Entscheidungen beim Diskutieren fest.",
      },
      kudos: {
        title: "Wertschätzung",
        subtitle: "Endet positiv — schick einem Teammitglied etwas Liebe.",
        empty: "Noch kein Kudos. Sei die erste Person, die jemanden würdigt!",
        to: "An",
        placeholder: "Sag warum (optional)…",
        send: "Kudos senden",
        from: "— {{name}}",
        anonymous: "— anonym",
        anonymousSend: "Anonym senden",
        someone: "jemanden",
        remove: "Kudo entfernen",
        card: {
          "thank-you": "Danke",
          "great-job": "Super gemacht",
          "well-done": "Gut gemacht",
          congratulations: "Glückwunsch",
          "totally-awesome": "Absolut großartig",
        },
      },
      gif: {
        add: "GIF",
        search: "GIFs suchen…",
        loading: "Suche…",
        none: "Keine GIFs gefunden.",
        hint: "Tippe, um nach einem GIF zu suchen.",
        unavailable: "GIF-Suche ist für dieses Board nicht eingerichtet.",
        remove: "GIF entfernen",
        poweredBy: "Bereitgestellt von KLIPY",
      },
      menu: {
        export: "Export",
        includeAuthors: "Namen der Autor:innen einschließen",
        settings: "Board-Einstellungen",
        gifsEnabled: "GIFs erlauben",
        retentionNotice: "Löscht sich automatisch am {{date}}",
        retentionKept: "Dieses Board wird behalten (keine Auto-Löschung).",
        keep: "Behalten",
        deleteNow: "Jetzt löschen",
        reallyDelete: "Wirklich löschen?",
      },
      roster: {
        makeFacilitator: "Zur Moderation machen",
        removeFacilitator: "Moderation entziehen",
        you: "(du)",
      },
      done: {
        title: "Retro abgeschlossen",
        body: "Dieses Board ist archiviert und schreibgeschützt.",
      },
      deleted: {
        title: "Board gelöscht",
        body: "Dieses Retro-Board wurde gelöscht.",
      },
      checkin: {
        icebreaker: "Check-in",
        noQuestion: "Aufwärmen…",
        shuffle: "Neue Frage",
        primeDirectiveTitle: "Die oberste Direktive",
        primeDirective:
          "Ungeachtet dessen, was wir herausfinden, verstehen und glauben wir aufrichtig, dass jede:r die bestmögliche Arbeit geleistet hat — angesichts des damaligen Wissensstands, der Fähigkeiten, der verfügbaren Ressourcen und der jeweiligen Situation.",
        agreements: "Arbeitsvereinbarungen",
        agreementsDefault:
          "• Vegas-Regel — was hier gesagt wird, bleibt hier\n• Probleme angreifen, nicht Personen\n• Immer nur ein Gespräch\n• Jede Stimme zählt",
        edit: "Bearbeiten",
      },
      roti: {
        title: "Return on Time Invested",
        question: "War diese Retro deine Zeit wert?",
        result: "Durchschnitt {{average}} · {{count}} Antworten",
        pending: "{{count}} Antworten · Durchschnitt ab 3 Antworten",
        anonymous: "Anonym — nur der Durchschnitt wird geteilt.",
      },
      icebreaker: {
        "one-word": "Beschreibe diesen Sprint in einem Wort.",
        weather:
          "Wie ist dein Wetterbericht für den Sprint? (sonnig, stürmisch, neblig…)",
        "sprint-emoji": "Welches Emoji fasst deinen Sprint zusammen?",
        "energy-level": "Wie ist dein Energielevel gerade, 1 bis 10?",
        highlight: "Was war dein Highlight des Sprints?",
        learned: "Was hast du kürzlich gelernt?",
        superpower: "Wenn du diesen Sprint eine Superkraft hättest — welche?",
        "movie-title": "Wäre dieser Sprint ein Film, wie hieße er?",
        song: "Welcher Song beschreibt deine Woche?",
        animal: "Welches Tier passt heute zu deiner Stimmung?",
        "gif-week": "Welches GIF fasst deine Woche zusammen?",
        grateful: "Wofür bist du diesen Sprint dankbar?",
        surprise: "Was hat dich diesen Sprint überrascht?",
        "coffee-count": "Wie viele Kaffees hat dieser Sprint gekostet?",
        weekend: "Worauf freust du dich am Wochenende?",
        "hidden-talent":
          "Verrate ein verstecktes Talent, das hier niemand kennt.",
        "if-color": "Welche Farbe hat deine Stimmung heute?",
        "proud-of": "Worauf bist du aus diesem Sprint stolz?",
        recharge: "Wie tankst du nach einem harten Sprint auf?",
        "one-wish": "Ein Wunsch für den nächsten Sprint?",
        "team-word": "Ein Wort für das Team in diesem Sprint?",
        "looking-forward": "Worauf freust du dich im nächsten Sprint?",
        "waffle-or-pancake":
          "Waffeln oder Pfannkuchen — und warum ist das wichtig?",
        "desert-island": "Welches Tool nähmst du auf eine einsame Insel mit?",
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
