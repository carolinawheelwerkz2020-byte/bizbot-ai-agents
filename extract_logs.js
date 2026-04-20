(async () => {
  const rows = Array.from(document.querySelectorAll('.logs-row'));
  const results = rows.map(row => {
    const text = row.innerText;
    const time = row.querySelector('.timestamp-column')?.innerText;
    return { time, text };
  });
  return results;
})()