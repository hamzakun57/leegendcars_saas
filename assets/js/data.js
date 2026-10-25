/* Leegend Cars — données du site */
(function () {
  const runtime = window.LCRuntimeConfig || {};
  const search = typeof location !== "undefined" ? location.search : "";
  const agencySlug = (typeof URLSearchParams !== "undefined" && search ? new URLSearchParams(search).get("agency") : "") || runtime.agencySlug || "";
  const CFG = {
    brand: "Votre agence",
    tagline: "Location de voitures",
    city: "",
    phonePrimary: "",
    phonePrimaryTel: "",
    phoneSecondary: "",
    phoneSecondaryTel: "",
    address: "",
    mapsUrl: "",
    hours: "",
    year: new Date().getFullYear(),

    /* Source des données : « supabase » (le navigateur interroge Supabase),
       « api » (un serveur Express répond) ou « auto » (Supabase s'il est
       configuré, le serveur sinon). Les deux marches sont maintenues : rien ne
       disparaît, on change seulement qui répond. */
    source: runtime.source || "api",

    /* Clé publique : conçue pour être lue par le navigateur. Ce n'est pas un
       secret — c'est ce qui permet d'appeler Supabase sans serveur. Ce qui
       protège les données, ce sont les règles d'accès (RLS) de la base, pas
       cette clé. La clé « service_role » ne doit JAMAIS être écrite ici. */
    supabaseUrl: runtime.supabaseUrl || "",
    agencySlug,
    supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxeWdzcHptbmRjc2JreGVpdWxtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NTkyODEsImV4cCI6MjEwNzIzNTI4MX0.2Xw305r5GJtBn85tnVPFs8MCLgJuiPLK9gnSSmu2pZI",
  };

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]
    );

  const NAV = [
    { label: "Véhicules", href: "#/vehicules" },
    { label: "Aéroports", href: "#/aeroports" },
    { label: "Prix & promos", href: "#/prix-promos" },
    { label: "FAQ", href: "#/faq" },
    { label: "À propos", href: "#/a-propos" },
    { label: "Contact", href: "#/contact" },
  ];

  const FEATURES = [
    "Conditions d'assurance précisées par l'agence",
    "Assistance selon les conditions de location",
    "Climatisation",
    "Caractéristiques indiquées sur chaque fiche",
    "Modalités de prise en charge confirmées par l'agence",
    "Kilométrage précisé avant validation",
  ];

  const EXCLUDED = ["Carburant", "Amendes et infractions"];

  const VEHICLE_FAQ = [
    {
      q: "Quels documents pour louer ce véhicule ?",
      a: "Les documents requis, l'âge minimum et les conditions de caution dépendent du véhicule et sont confirmés par l'agence.",
    },
    {
      q: "Comment se passe la livraison à l'aéroport ?",
      a: "Indiquez le lieu et l'heure souhaités. L'agence vous confirmera si la prise en charge est possible et son éventuel coût.",
    },
    {
      q: "Comment fonctionne le carburant ?",
      a: "La politique de carburant applicable est précisée par l'agence avant la confirmation de la location.",
    },
  ];

  /* La flotte vit dans la base : elle est saisie dans le back-office et lue
     par le navigateur. Cette liste n'était qu'un jeu de démonstration ; la
     laisser ici affichait trois voitures qui n'existent pas, y compris quand
     l'internaute parcourt le site hors connexion.

     Un parc vide est un état normal : les pages affichent alors un message
     d'attente plutôt que des modèles imaginaires. */
  const VEHICLES = [];
  const TRUST = [
    {
      icon: "shield",
      title: "Conditions précisées",
      text: "Consultez les conditions de chaque véhicule et demandez confirmation à l'agence avant de réserver.",
    },
    {
      icon: "truck",
      title: "Prise en charge",
      text: "Les modalités de remise et de restitution sont convenues directement avec l'agence.",
    },
    {
      icon: "tag",
      title: "Tarif confirmé",
      text: "Demandez le tarif détaillé et les éventuels frais avant de confirmer votre demande.",
    },
    {
      icon: "sparkles",
      title: "Informations véhicule",
      text: "Chaque fiche présente les caractéristiques communiquées par l'agence.",
    },
  ];

  const PROCESS = [
    {
      num: "01",
      dur: "~ 2 min",
      title: "Vous faites la réservation",
      text: "Sur le site : dates, lieu de prise en charge, retour et véhicule souhaité. Aucun compte à créer.",
    },
    {
      num: "02",
      dur: "Confirmation",
      title: "L'agence vous répond",
      text: "L'agence vérifie la disponibilité, le tarif et les conditions avant de confirmer la réservation.",
    },
    {
      num: "03",
      dur: "Selon accord",
      title: "Prise en charge",
      text: "Le véhicule est remis au lieu et à l'heure convenus avec l'agence.",
    },
  ];

  const REVIEWS = [];

  const GUIDE = [
    {
      span: true,
      title: "Pourquoi louer une voiture ?",
      text: "Un véhicule peut faciliter vos déplacements et vous laisser organiser votre itinéraire selon vos besoins.",
    },
    {
      title: "Prise en charge à l'aéroport",
      text: "Indiquez l'aéroport et l'horaire souhaités. L'agence vous confirmera les possibilités et les frais éventuels.",
    },
    {
      title: "Tarifs transparents",
      text: "Demandez le tarif détaillé et les frais éventuels avant de confirmer votre demande.",
    },
    {
      title: "Où récupérer votre voiture ?",
      text: "Les lieux et horaires de prise en charge sont convenus directement avec l'agence.",
    },
    {
      title: "Caution",
      text: "Le montant et les conditions de restitution de la caution sont précisés avant la réservation.",
    },
    {
      title: "Réservation rapide",
      text: "Envoyez vos dates et le lieu souhaité. L'agence vous répondra avec les disponibilités et les conditions.",
    },
    {
      span: true,
      title: "Une demande adaptée à votre trajet",
      text: "Précisez votre itinéraire et l'agence vous indiquera les conditions d'utilisation applicables.",
    },
  ];

  const HOME_FAQ = [
    {
      q: "Quels documents sont nécessaires pour louer ?",
      a: "Les documents requis et l'âge minimum sont confirmés par l'agence selon le véhicule et le contrat.",
    },
    {
      q: "Y a-t-il une limite de kilométrage ?",
      a: "La limite et les éventuels frais de kilométrage sont précisés dans les conditions communiquées avant validation.",
    },
    {
      q: "Comment fonctionne le carburant ?",
      a: "L'agence vous indique la politique de carburant applicable avant la confirmation de la location.",
    },
    {
      q: "Où puis-je récupérer le véhicule ?",
      a: "Indiquez le lieu souhaité dans votre demande. L'agence vous confirmera la disponibilité et les modalités de prise en charge.",
    },
    {
      q: "Quels moyens de paiement acceptez-vous ?",
      a: "Les moyens de paiement, la caution et les délais sont confirmés directement par l'agence avant la réservation.",
    },
  ];

  const FAQ_CATS = [
    {
      title: "Conditions de location",
      items: [
        {
          q: "Quels documents sont nécessaires ?",
          a: "L'agence vous communique les documents requis et l'âge minimum selon le véhicule avant la réservation.",
        },
        {
          q: "Un conducteur additionnel, c'est possible ?",
          a: "Demandez confirmation à l'agence : les conditions et les éventuels frais sont précisés avant la réservation.",
        },
      ],
    },
    {
      title: "Paiement",
      items: [
        {
          q: "Quels moyens de paiement acceptez-vous ?",
          a: "Les moyens de paiement et la caution sont indiqués par l'agence dans les conditions de réservation.",
        },
        {
          q: "Les prix affichés sont-ils les prix finaux ?",
          a: "Les prix affichés sont indicatifs. L'agence confirme le tarif détaillé et les frais éventuels avant validation.",
        },
      ],
    },
    {
      title: "Assurance & sinistre",
      items: [
        {
          q: "L'assurance est-elle incluse dans le prix ?",
          a: "La couverture, la franchise et les exclusions varient selon le véhicule; consultez les conditions communiquées par l'agence.",
        },
        {
          q: "Que faire en cas d'accident ou de panne ?",
          a: "Les coordonnées et modalités d'assistance sont précisées dans les documents remis par l'agence.",
        },
      ],
    },
    {
      title: "Réservation, annulation & modification",
      items: [
        {
          q: "Comment réserver ?",
          a: "Envoyez vos dates, le lieu de prise en charge et le véhicule souhaité. L'agence vous confirmera la disponibilité et les conditions.",
        },
        {
          q: "Annulation : ai-je des frais ?",
          a: "Les délais et frais d'annulation sont indiqués dans les conditions communiquées par l'agence.",
        },
        {
          q: "Puis-je modifier ma réservation ?",
          a: "Toute modification dépend de la disponibilité et des conditions de réservation. Contactez l'agence au plus tôt.",
        },
      ],
    },
    {
      title: "Livraison & restitution",
      items: [
        {
          q: "La prise en charge à l'aéroport est-elle possible ?",
          a: "Indiquez l'aéroport et l'heure souhaités. L'agence vous confirmera si la prise en charge est possible et son coût éventuel.",
        },
        {
          q: "Et la restitution à l'aéroport ?",
          a: "Le lieu et les frais éventuels de restitution sont à convenir directement avec l'agence.",
        },
        {
          q: "Livraison à l'hôtel, au riad ou dans une autre ville ?",
          a: "Précisez le lieu souhaité dans votre demande. L'agence vous confirmera les possibilités et les frais éventuels.",
        },
      ],
    },
    {
      title: "Carburant & véhicule",
      items: [
        {
          q: "Comment fonctionne le carburant ?",
          a: "La politique de carburant applicable est précisée par l'agence avant la confirmation de la location.",
        },
        {
          q: "Vos véhicules sont-ils récents ?",
          a: "Les caractéristiques et informations d'entretien sont indiquées sur les fiches des véhicules ou confirmées par l'agence.",
        },
        {
          q: "Y a-t-il une limite de kilométrage ?",
          a: "Les limites et frais éventuels sont précisés dans les conditions communiquées avant validation.",
        },
      ],
    },
  ];

  const CONDITIONS = [
    {
      title: "Conducteur & documents",
      text: "L'âge minimum, l'ancienneté du permis et les documents requis dépendent du véhicule et sont communiqués par l'agence avant la réservation.",
    },
    {
      title: "Tarif, caution & paiement",
      text: "Le tarif détaillé, le montant et le mode de dépôt de la caution, ainsi que les moyens de paiement sont confirmés par l'agence avant toute validation.",
    },
    {
      title: "Assurance & utilisation",
      text: "La couverture, les franchises, les exclusions, le kilométrage, la politique de carburant et les conditions d'utilisation applicables figurent dans les conditions de location remises par l'agence.",
    },
    {
      title: "Prise en charge & restitution",
      text: "Les lieux, horaires, frais éventuels et modalités de remise ou de restitution sont convenus avec l'agence et précisés dans la confirmation de réservation.",
    },
    {
      title: "Annulation & modification",
      text: "Les délais, frais et possibilités de modification dépendent de la réservation. Consultez la confirmation et le contrat ou contactez l'agence avant toute modification.",
    },
    {
      title: "Autres conditions",
      text: "Les conditions contractuelles propres à chaque location prévalent. Demandez toute précision à l'agence et lisez le contrat avant de signer.",
    },
  ];

  const COUNTRY_CODES = [
    { label: "Maroc (+212)", code: "+212" },
    { label: "France (+33)", code: "+33" },
    { label: "Belgique (+32)", code: "+32" },
    { label: "Suisse (+41)", code: "+41" },
    { label: "Espagne (+34)", code: "+34" },
    { label: "Royaume-Uni (+44)", code: "+44" },
    { label: "Allemagne (+49)", code: "+49" },
    { label: "Italie (+39)", code: "+39" },
    { label: "Pays-Bas (+31)", code: "+31" },
    { label: "Canada (+1)", code: "+1" },
    { label: "États-Unis (+1)", code: "+1" },
    { label: "Autre", code: "" },
  ];

  const BABY_SEAT_DAILY = 0;

  const PICKUP_LOCATIONS = ["À convenir avec l'agence"];

window.DATA = {
      CFG,
      escapeHtml,
      NAV,
    FEATURES,
    EXCLUDED,
    VEHICLE_FAQ,
    VEHICLES,
      /* Renseignés par app.js quand la base n'a pas pu être lue : distingue
         « garage vide » de « site en panne ». Vides = tout va bien. */
      FLETTE_ERREUR: "",
      FLETTE_DETAIL: "",
    TRUST,
    PROCESS,
    REVIEWS,
    GUIDE,
    HOME_FAQ,
    FAQ_CATS,
    CONDITIONS,
    COUNTRY_CODES,
    PICKUP_LOCATIONS,
    BABY_SEAT_DAILY,
  };
})();
