// Shared query for aggregated reservation counts per tour + calendar date
// + departure time. Used by both GET /bookings/summary (admin panel) and
// the daily summary email job (see plugins/scheduler.js), so the two
// stay consistent instead of maintaining the same SQL twice.
export async function getReservationsSummary(pg, filters = {}) {
  const { tourId, dateFrom, dateTo, timeFrom, timeTo, includeCancelled = false } = filters

  const conditions = []
  const values = []

  if (tourId) { values.push(tourId); conditions.push(`b.tour_id = $${values.length}`) }
  if (dateFrom) { values.push(dateFrom); conditions.push(`td.date >= $${values.length}`) }
  if (dateTo) { values.push(dateTo); conditions.push(`td.date <= $${values.length}`) }
  if (timeFrom) { values.push(timeFrom); conditions.push(`ts.time >= $${values.length}`) }
  if (timeTo) { values.push(timeTo); conditions.push(`ts.time <= $${values.length}`) }
  if (!includeCancelled) conditions.push(`b.status != 'cancelled'`)

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const { rows } = await pg.query(
    `SELECT t.id AS tour_id, t.name AS tour_name,
            td.id AS tour_date_id, td.date,
            ts.id AS tour_schedule_id, ts.time,
            COUNT(*)::int AS booking_count,
            COALESCE(SUM(b.quantity), 0)::int AS adults,
            COALESCE(SUM(b.number_of_children), 0)::int AS children,
            COALESCE(SUM(b.number_of_babies), 0)::int AS babies,
            COALESCE(SUM(b.number_of_pets), 0)::int AS pets,
            STRING_AGG(c.full_name, ', ' ORDER BY c.full_name) AS customer_names
     FROM bookings b
     JOIN tours t ON t.id = b.tour_id
     JOIN tour_dates td ON td.id = b.tour_date_id
     JOIN tour_schedules ts ON ts.id = b.tour_schedule_id
     JOIN customers c ON c.id = b.customer_id
     ${where}
     GROUP BY t.id, t.name, td.id, td.date, ts.id, ts.time
     ORDER BY td.date ASC, ts.time ASC, t.name ASC`,
    values
  )
  return rows
}