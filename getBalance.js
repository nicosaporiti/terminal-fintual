require("dotenv").config();
const axios = require("axios");
const url = "https://fintual.cl/api/goals";
const user = process.env.USER_EMAIL;

axios
  .get(url, {
    params: {
      user_email: process.env.USER_EMAIL,
      user_token: process.env.USER_TOKEN,
    },
  })
  .then(async (res) => {
    const { data } = await res.data;
    const factor = 1;

    function formatNumber(n) {
      return new Intl.NumberFormat("es-ES").format(n).split(",")[0];
    }

    const goals = data.map((data, index) => {
      const { name, goal_type, nav, profit, deposited } = data.attributes;
      return {
        goal: name,
        type: goal_type,
        nav: nav / factor,
        profit: profit / factor,
        deposited: deposited / factor,
        profit_ratio: ((profit / deposited) * 100).toFixed(2) + " %",
      };
    });

    const formatGoals = goals.map((data, index) => {
      const { goal, type, nav, profit, deposited, profit_ratio } = data;
      return {
        goal: goal,
        type: type,
        nav: formatNumber(nav),
        goal_profit: formatNumber(profit),
        deposited: formatNumber(deposited),
        profit_ratio: profit_ratio,
      };
    });

    let sumNav = 0;
    let sumProfit = 0;
    let sumDeposited = 0;

    for (let i = 0; i < goals.length; i++) {
      sumNav += goals[i].nav;
      sumProfit += goals[i].profit;
      sumDeposited += goals[i].deposited;
    }

    console.log("\x1b[35m",`                                       
                                                                                                             
    _|_|_|_|  _|              _|                          _|                                          
    _|            _|_|_|    _|_|_|_|  _|    _|    _|_|_|  _|        _|_|_|    _|_|    _|_|_|  _|_|    
    _|_|_|    _|  _|    _|    _|      _|    _|  _|    _|  _|      _|        _|    _|  _|    _|    _|  
    _|        _|  _|    _|    _|      _|    _|  _|    _|  _|      _|        _|    _|  _|    _|    _|  
    _|        _|  _|    _|      _|_|    _|_|_|    _|_|_|  _|  _|    _|_|_|    _|_|    _|    _|    _|  
                                                                                                      
    `, "\x1b[35m")
    console.log("\x1b[32m ____________________________________________________________________________________________________\x1b[32m", "\x1b[0m");
    console.log(" ");
    console.log("\x1b[32m Bienvenido \x1b[32m " + user + "\x1b[32m !!! Este es tu balance en FINTUAL a la fecha  \x1b[32m ", "\x1b[0m")
    console.log("\x1b[32m ____________________________________________________________________________________________________\x1b[32m", "\x1b[0m");
    console.table(formatGoals);
    console.table({
      sumNav: formatNumber(sumNav),
      sumDeposited: formatNumber(sumDeposited),
      sumProfit: formatNumber(sumProfit),
      profit_ratio: ((sumProfit / sumDeposited) * 100).toFixed(2) + " %",
    });

  })
  .catch(error => console.log(error.message));
