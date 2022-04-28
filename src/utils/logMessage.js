export default (...arg) => {
  if (sessionStorage?.getItem('react16-adv-logging')) {
    console.log(...arg);
  }
};
