export default (...arg) => {
  if (sessionStorage?.getItem('react16-adv-logging') === 'true') {
    console.log(...arg);
  }
};
