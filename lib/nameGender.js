/**
 * First-name sex when the POS client record has none. Recorded
 * `details.sex` always wins. Names not in the lists stay unknown —
 * we do not guess from spelling.
 */

const FEMALE = new Set(
  `
    abbey abigail ada adela adelaide adele adeline adriana adrienne aisha
    alana aleena aleksandra alexa alexandria alexandra alexis alice alicia
    alina alison allison alyssa amal amanda amelia amina amira amy ana
    anastasia andrea angela angelica angelina anika anita anja ann anna
    anne anneliese annabelle annette annie anouk antoinette antonia april
    aria ariana ariane arianne asha ashley asma astrid aubrey audrey
    aurelia aurora ava aya ayla barbara beatrice beatrix belinda bernadette
    bertha beth betty beverly bianca bonnie brenda briana brianna bridget
    britany britney brittany brooke caitlin camila camilla camille candace
    candice cara carla carly carmen carol carolina caroline carolyn carrie
    casey cassandra cassie catherine cathy cecile cecilia celeste celia
    celina chantal charlene charlotte cheryl chloe chris christina christine
    cindy claire clara clarice claudia colette coleen colleen constance
    cora corinne courtney crystal cynthia daisy dana danielle daphne
    darlene debora deborah debra denise desiree diana diane dianne dominique
    donna dora doreen doris dorothy eden edith edna eileen elaine eleanor
    elena elena elisa elisabeth elise elisha eliza elizabeth ella ellen
    ellie eloise elsa elsie elvira elyse emilia emily emma erica erika
    erin esther ethel eugenie eva evelyn evie faith fatima fatma faye
    felicia fiona florence frances francesca francine gabrielle gail
    genevieve georgia georgina geraldine gillian gina giorgia giselle
    gladys gloria grace gracie gretchen gwendolyn habiba halle hana hannah
    harley harmoni harmony harriet hasna hatice hayley hazel heather heidi
    helen helena helene henrietta hilda holly hope ida ilene ines ingrid
    irene iris irma isabel isabella isabelle ivana ivy jackie jacqueline
    jade jaime jamie jane janet janice janie janine jasmine jeanette
    jeanne jeannette jenna jennifer jenny jess jessica jessie jill jillian
    jo joan joann joanna joanne jocelyn jodi jodie johanna josephine joy
    joyce judith judy julia julianna julie juliette justine kaitlin kara
    karen karin karina karla katarina kate katelyn katherine kathleen
    kathryn kathy katie katrina kay kayla kaylee keira kelley kelli kellie
    kelly kelsey kendra kerry kim kimberley kimberly kira krista kristen
    kristin kristina kristine krystal kylie lacey lana lara larissa laura
    laureen lauren laurie leah leanne leila lena leona lesley leslie leyla
    lila lillian lily lina linda lindsay lisa lise liz liza lorraine lottie
    louise lucie lucille lucy lydia lyn lyna lynne mabel madeleine madeline
    madison mae maggie mahsa maia maisie mandy mara marcella marcia margaret
    margot maria mariah marianne marie marielle marilyn marina marion
    marisa marisol marissa marjorie marlene marsha marta martha martina
    mary maryam maureen mavis maxine maya meagan meaghan meghan melaney
    melanie melinda melissa melody mercedes meredith mia michaela michelle
    mildred millie mina mindy miranda miriam molly mona monica monique
    morgan myra myriam nadia nadine nancy naomi natalia natalie natasha
    nathalie nellie nicole nina noelle noemi nora nora noreen norma olga
    olivia paige pam pamela paola patricia patsy patty paula paulette
    pauline pearl peggy penelope penny phyllis polly precious priya
    rachel rachelle ramona rana raquel rebecca rebekah regina renee rhonda
    rita roberta robin robyn rochelle rosa rosalie rose rosemary rosie
    roxanne ruby ruth sabrina saffron sally samantha sandra sandy sania
    sara sarah sasha savanna savannah selena selma serena shania shannon
    shari sharon shauna sheila shelley shelly sherry shirley silvia simone
    sofia sofie sonia sonja sophia sophie stacey stacy stella stephanie
    sue susan susana susanna susanne susie suzanne suzie sydney sylvia
    tabitha tamara tami tammy tania tanya tara teresa teri terry tesla
    thea thelma theresa therese tiffany tina tonya tracey tracy tricia
    valerie vanessa vera veronica vicki vickie victoria violet virginia
    vivian viviane wanda wendy whitney winnie yasmin yasmina yolanda
    yvette yvonne zahra zara zoe zoey
    amina asmaa basma basma briana candice eloisa gianna gloria hannelore
    hoda khadidja khadija lamia marwa mennatallah mona naima rana rawya
    riham rubeena sahra salma samia sandrine shinymol souad suhair sylia
    valerie wafaa warde zineb anie briana maleeka
  `
    .trim()
    .split(/\s+/),
);

const MALE = new Set(
  `
    aaron abdallah abdel abdul abdullah abraham adam adrian ahmad ahmed
    alan albert alec alejandro aleksandar alex alexander alexandre alfred
    ali allan allen alvin amir amr andre andrea andreas andrew andy angelo
    anis anthony antoine anton antony arnold arthur ashton austin avery
    axel barry ben benjamin bernard bill billy blair blake bob bobby
    bradley brandon brendan brent brett brian bruce bryan bryce caleb
    calvin cameron carl carlos carson cedric charles charlie chris
    christian christopher clarence clark claude clayton clifford clint
    clinton clyde cody colin connor conrad corey cory craig curtis cyril
    dale damian damien dan daniel danny darren daryl dave david dean
    dennis derek devin diego dominic donald douglas drew duncan dwayne
    dylan earl ed eddie edgar edmond edmund eduardo edward edwin eli
    elias elijah elliott ellis elmer emil emile emilio emmanuel eric erik
    ernest ernesto ethan eugene evan everett ezra felix fernando floyd
    forrest francis francisco francois frank franklin fred frederick
    gabriel gareth garrett gary gavin gene geoffrey george gerald gerard
    gerry gilbert giles glenn gordon graham grant greg gregg gregory
    guillaume gustavo guy harold harry hasan hassan hayden heath henry
    herbert herman howard hugh hugo hunter ian ibrahim isaac isaiah ivan
    jack jackson jacob jacques jaime jake james jamie jared jason javier
    jay jeff jefferson jeffrey jeremy jerome jerry jesse jessie jim jimmy
    joachim joe joel joey john johnny jon jonathan jordan jorge jose
    joseph josh joshua juan judd julian julio justin karl keith ken
    kenneth kenny kent kevin khaled kian kirk kurt kyle lance larry
    laurence lawrence lee leo leon leonard leroy lester lewis liam lloyd
    logan louis luc lucas luis luke malcolm malek malik marc marcel marco
    marcus mario mark marshall martin marty mason mathew matt matthew
    maurice max maxim maximilian maxime michael micheal michel mick mickey
    miguel mike mitchell mohamad mohamed mohammad mohammed morgan morris
    mostafa mustafa nathan nathaniel neil nelson nicholas nick nicolas
    nigel noah nolan norman oliver omar oscar owen pablo patrick paul
    pedro perry peter phil philip phillip pierre preston quentin ralph
    ramon randall randy raul ray raymond reginald reid ricardo rich
    richard rick ricky rob robbie robert robin rocky rod rodney roger
    roland ron ronald ross roy ruben russell ryan sam samir samuel scott
    sean sebastian serge sergio seth shane shaun shawn sidney simon
    spencer stanley stephen steve steven stewart stuart syed ted terence
    terry theodore thomas tim timothy tobias todd tom tommy tony travis
    trevor troy tyler tyrone vernon victor vincent virgil wade wallace
    walter warren wayne wesley wilfred will william wilson wyatt xavier
    yahya yasser yosef yousef yusuf zach zachary zack
    abderraouf amin badih brian christopher claude
    douglas erwin fares faraz fahim felix fernando francis francois
    george glenn ibikunle jean luca malik marc mohamad mohamed mostafa
    muhammad mustafa nurhussein rashad russell saeid salim seifeldin
    taro usama william yousef yousuf yaser zeinhom
  `
    .trim()
    .split(/\s+/),
);

function foldName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function firstToken(value) {
  const text = foldName(value).replace(/[^a-z\s'-]/g, ' ');
  const parts = text.split(/[\s'-]+/).filter((part) => part.length >= 2);
  return parts[0] || '';
}

function titleSex(value) {
  const text = foldName(value);
  if (text === 'f' || text === 'female' || text === 'woman' || text === 'w') return 'Female';
  if (text === 'm' || text === 'male' || text === 'man') return 'Male';
  return '';
}

/**
 * `{ sex, source }` where source is `recorded` (POS details.sex),
 * `inferred` (first-name list), or '' when unknown.
 */
export function sexFromClient(client) {
  const details = client?.details && typeof client.details === 'object' && !Array.isArray(client.details) ? client.details : {};
  const recorded = titleSex(details.sex);
  if (recorded) return { sex: recorded, source: 'recorded' };

  const type = String(client?.client_type || client?.type || '').trim().toLowerCase();
  if (type === 'company') return { sex: '', source: '' };

  const first = firstToken(client?.first_name);
  if (!first) return { sex: '', source: '' };
  if (FEMALE.has(first) && !MALE.has(first)) return { sex: 'Female', source: 'inferred' };
  if (MALE.has(first) && !FEMALE.has(first)) return { sex: 'Male', source: 'inferred' };
  return { sex: '', source: '' };
}

export function sexFromName(firstName) {
  const first = firstToken(firstName);
  if (!first) return '';
  if (FEMALE.has(first) && !MALE.has(first)) return 'Female';
  if (MALE.has(first) && !FEMALE.has(first)) return 'Male';
  return '';
}
