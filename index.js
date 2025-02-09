const icsTool = require('ics');
const fs = require('fs');
const winston = require('winston');
const cheerio = require('cheerio');

PAGE_URL = 'https://www.vlr.gg';
VCT_URL = PAGE_URL + '/vct';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.cli(),
  defaultMeta: {service: 'user-service'},
  transports: [
    new winston.transports.File({filename: 'error.log', level: 'error'}),
    new winston.transports.File({filename: 'combined.log'}),
    new winston.transports.Console(),
  ],
});

async function fetchPage(url) {
  try {
    logger.info(`Fetching: ${url} ...`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('text/html')) {
      throw new TypeError("Oops, we haven't got HTML!");
    }
    logger.info(`Fetched: ${url}`);
    return response.text();
  } catch (error) {
    logger.error(error.message);
  }
}

async function fetchDOM(url) {
  const events = await fetchPage(url);
  const $ = cheerio.load(events);
  return $;
}

function parseEventDates(datesText) {
  const [startDateText, endDateText] = datesText
    .split('—')
    .map((date) => date.trim());
  const currentYear = new Date().getFullYear();

  const parseDate = (str) => {
    const [month, day] = str.split(' ');
    return new Date(`${month} ${day}, ${currentYear} 00:00:00 GMT`)
      .toISOString()
      .split('T')[0];
  };

  const startDate = parseDate(startDateText);
  const endDate = endDateText ? parseDate(endDateText) : startDate;
  return [startDate, endDate];
}
function parseDateToComponents(dateStr) {
  const date = new Date(dateStr);
  return [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    0,
    0, // Events usually start at midnight unless specified
  ];
}

function writeICS(params) {}

function generateMatches(dom) {
  const $ = cheerio.load(dom.html());
  let matches = [];

  $('.wf-card').each((_, card) => {
    let dateText = $(card)
      .prev('.wf-label.mod-large')
      .clone()
      .children()
      .remove()
      .end()
      .text()
      .trim();

    $(card)
      .find('.match-item')
      .each((_, match) => {
        const matchElement = $(match);
        const timeText = matchElement.find('.match-item-time').text().trim();
        const status = matchElement.find('.ml-status').text().trim();
        const eta = matchElement.find('.ml-eta.mod-completed').text().trim();

        // Extract teams and scores
        const teams = matchElement
          .find('.match-item-vs-team')
          .map((_, team) => ({
            name:
              $(team).find('.match-item-vs-team-name .text-of').text().trim() ||
              'TBD',
            score:
              parseInt(
                $(team).find('.match-item-vs-team-score').text().trim(),
                10
              ) || 0,
            isWinner: $(team).hasClass('mod-winner'),
          }))
          .get();

        // Extract event details
        const eventSeries = matchElement
          .find('.match-item-event-series')
          .text()
          .trim();
        const eventType = matchElement
          .find('.match-item-event')
          .contents()
          .last()
          .text()
          .trim();

        // Extract video stats
        const stats = matchElement
          .find('.match-item-vod .wf-tag')
          .map((_, stat) => $(stat).text().trim())
          .get();

        // Convert date and time to standard format
        const matchDate = new Date(`${dateText} ${timeText}`);
        const durationMinutes = 120; // Assume matches are 2 hours long
        const matchEndDate = new Date(
          matchDate.getTime() + durationMinutes * 60 * 1000
        );

        // Format match name
        let matchName = `${teams[0]?.name || 'TBD'} vs ${
          teams[1]?.name || 'TBD'
        }`;
        if (teams[0]?.score || teams[1]?.score) {
          matchName += ` - ${teams[0].score} : ${teams[1].score}`;
        }

        const matchData = {
          title: matchName,
          description: `${eventSeries} ${eventType}`,
          start: [
            matchDate.getFullYear(),
            matchDate.getMonth() + 1,
            matchDate.getDate(),
            matchDate.getHours(),
            matchDate.getMinutes(),
          ],
          end: [
            matchEndDate.getFullYear(),
            matchEndDate.getMonth() + 1,
            matchEndDate.getDate(),
            matchEndDate.getHours(),
            matchEndDate.getMinutes(),
          ],
          organizer: {
            name: `无畏契约 ${eventSeries}`,
            email: 'vct@qq.com',
          },
          url: 'https://vct.qq.com',
          status: 'TENTATIVE',
          geo: {lat: 30.0095, lon: 120.2669},
          startInputType: 'utc',
          startOutputType: 'utc',
          endInputType: 'utc',
          endOutputType: 'utc',
          alarms:
            status.toLowerCase() === 'upcoming'
              ? [
                  {
                    action: 'audio',
                    trigger: {
                      minutes: 30,
                      before: true,
                      repeat: 1,
                      attachType: 'VALUE=URI',
                      attach: 'Glass',
                    },
                  },
                ]
              : [],
        };

        matches.push(matchData);
        logger.info(JSON.stringify(matchData));
      });
  });

  return matches;
}

async function generateEvents(dom) {
  const $ = cheerio.load(dom.html());
  let events = [];

  $('div.events-container-col a').each(async function (_, el) {
    const eventElement = $(el);
    const eventTitle = eventElement.find('.event-item-title').text().trim();
    const status = eventElement
      .find('.event-item-desc-item-status')
      .text()
      .trim();
    const prizePool = eventElement
      .find('.event-item-desc-item.mod-prize')
      .contents()
      .first()
      .text()
      .trim();

    // Extract and parse event dates
    const datesText = eventElement
      .find('.event-item-desc-item.mod-dates')
      .contents()
      .first()
      .text()
      .trim();
    const [startDate, endDate] = parseEventDates(datesText);

    const region = eventElement
      .find('.event-item-desc-item.mod-location i')
      .attr('class')
      .split(' ')
      .pop()
      .replace('mod-', '');

    // Construct event page URL
    const link = el.attribs['href'];
    const matchesURL = '/event/matches/' + link.split('/event/')[1];
    const eventPage = await fetchDOM(PAGE_URL + matchesURL);

    // Fetch match data
    const matches = generateMatches(eventPage);

    const eventData = {
      title: eventTitle,
      description: `Prize Pool: ${prizePool} | Status: ${status} | Region: ${region}`,
      start: parseDateToComponents(startDate),
      end: parseDateToComponents(endDate),
      organizer: {
        name: `无畏契约 ${eventTitle}`,
        email: 'vct@qq.com',
      },
      url: PAGE_URL + link,
      status: 'CONFIRMED',
      geo: {lat: 30.0095, lon: 120.2669},
      startInputType: 'utc',
      startOutputType: 'utc',
      endInputType: 'utc',
      endOutputType: 'utc',
      alarms:
        status.toLowerCase() === 'upcoming'
          ? [
              {
                action: 'audio',
                trigger: {
                  minutes: 60,
                  before: true,
                  repeat: 1,
                  attachType: 'VALUE=URI',
                  attach: 'Glass',
                },
              },
            ]
          : [],
      matches,
    };

    events.push(eventData);
    logger.info(JSON.stringify(eventData));
  });

  return events;
}

async function main() {
  const events = await fetchDOM(VCT_URL);
  const eventsMap = generateEvents(events);
  const result = icsTool.createEvents(eventsMap);

  if (result.error) {
    console.error(result.error);
  } else {
    fs.writeFileSync(`./vct-cn.ics`, result.value);
  }
}
main();
