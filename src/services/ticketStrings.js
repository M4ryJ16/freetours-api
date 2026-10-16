// Source-language (Spanish) text of the booking ticket email. This is the
// single catalog the mailer reads from: Spanish is sent as-is, any other
// language is produced by translating these values (see translator.js).
//
// Keep each value a plain-text sentence/phrase WITHOUT interpolated
// placeholders — dynamic values (names, dates, URLs, counts) are inserted
// by the mailer around the translated text, so machine translation can't
// mangle them.

export const SOURCE_LANG = 'es'

export const TICKET_STRINGS_ES = {
  subjectPrefix: "Tu ticket de free tour:",
  adult: "adulto",
  adults: "adultos",
  child: "niño",
  children: "niños",
  baby: "bebé",
  babies: "bebés",
  pet: "mascota",
  pets: "mascotas",
  headerConfirmed: "Reserva confirmada",
  headerCancelled: "Reserva cancelada",
  freeTourBadge: "Excursión gratuita",
  greetingHello: "Hola",
  greetingSpotOn: "esta es tu plaza en",
  routeLabel: "RUTA",
  labelDate: "Fecha",
  labelTime: "Hora",
  labelParty: "Personas",
  labelReference: "Referencia",
  labelFinalPrice: "Precio final",
  meetingPoint: "Punto de encuentro",
  mapAlt: "Punto de encuentro",
  mapDataBy: "Datos del mapa",
  mapOpenInOsm: "abrir en OpenStreetMap",
  mapUnavailable: "El mapa del punto de encuentro no está disponible.",
  mapViewInOsm: "Ver en OpenStreetMap",
  mapContactUs: "Por favor contáctanos para indicaciones.",
  freeTourReassurance: "Esta excursión es gratuita — no se necesita pago ni ninguna otra acción. ¡Nos vemos allí!",
  noticeConditional: "Esta reserva está condicionada y puede sufrir variaciones o cancelaciones si no se cumple el mínimo de 4 personas. Te lo notificaremos por WhatsApp o email. Gracias por tu comprensión. El guía se reserva el derecho de admisión.",
  noticeArriveEarly: "Llega al punto de encuentro con 15 minutos de antelación. La salida es puntual y no podremos esperar a quien llegue tarde.",
  noticeBringItems: "No olvides traer contigo lo necesario para la ruta (calzado cómodo, agua y ropa adecuada para la meteorología prevista).",
  noticeHealthInsurance: "El seguro del tour solo cubre incidentes ocurridos directamente durante el trayecto. No cubre malestares gástricos por alimentos/bebidas (ya que no los proporcionamos) ni incidentes por descuido personal. Las mascotas son bienvenidas reservando su lugar, pero no tienen cobertura de seguro y cualquier gasto o imprevisto corre totalmente por cuenta de sus dueños.",
  noticeLegal: "Seguridad y responsabilidad en el tour: Guío los paseos con total tranquilidad porque cuento con un seguro de responsabilidad civil profesional. No obstante, ten en cuenta que cada participante se une a la caminata bajo su propia responsabilidad en lo referente a su estado físico, salud y pertenencias personales. Te recomiendo venir con calzado cómodo apto para los adoquines de Dublín y avisarme si tienes alguna molestia antes de empezar. El seguro cubre la actividad profesional del guía, pero no lesiones previas, dolencias de casa ni despistes con tus objetos personales. ¡Prevenir es curar!",
  buttonViewBooking: "Ver mi reserva",
  buttonCancelBooking: "Cancelar reserva",
  buttonBookingCancelled: "Reserva cancelada",
  qrAlt: "Código QR para gestionar tu reserva",
  qrCaption: "Escanea para gestionar o cancelar tu reserva",
  freeTourNote: "Un free tour es una visita guiada sin precio fijo: al finalizar, cada persona aporta la propina que considere justa según lo que le haya aportado la experiencia. Si quieres dejar propina, puedes hacerlo en efectivo o mediante tarjeta, Revolut o Bizum.",
  footerRights: "Todos los derechos reservados.",
  footerPrivacy: "Política de privacidad",
  textHello: "Hola",
  textYourSpot: "Tu plaza en",
  textDate: "Fecha",
  textDepartureTime: "Hora de salida",
  textParty: "Personas",
  textReference: "Referencia de la reserva",
  textMeetingPointOnMap: "El punto de encuentro se muestra en el mapa de este correo.",
  textViewOnOsm: "Verlo en OpenStreetMap",
  textManageBooking: "Para ver, editar o cancelar tu reserva, visita",
  textContactUs: "Contáctanos si necesitas editar o cancelar tu reserva.",
  textPrivacy: "Política de privacidad"
}
