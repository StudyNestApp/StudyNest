import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export const formatRelativeRoomDate = (dateString: string, now: dayjs.Dayjs) => {
  if (!dateString) {
    return 'No date';
  }

  let date: dayjs.Dayjs;
  const timeOnlyRegex = /^\d{1,2}:\d{2}(:\d{2})?$/;

  if (timeOnlyRegex.test(dateString)) {
    const today = dayjs().format('YYYY-MM-DD');
    const fullDateTimeString = `${today} ${dateString}`;
    date = dayjs(fullDateTimeString);
  } else {
    date = dayjs(dateString);
  }

  if (!date || !date.isValid()) {
    console.warn('Invalid date received:', dateString);
    return 'Invalid date';
  }

  const relative = date.from(now);
  return `🕐 ${relative}`;
};
