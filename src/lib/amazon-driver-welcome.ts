// Dedicated to the new Amazon flow. Existing onboarding templates stay unchanged.
export const amazonDriverWelcome = {
  name: 'dropx_driver_id_created_v1',
  language: 'en',
  category: 'UTILITY',
  parameter_format: 'POSITIONAL',
  components: [
    {type:'BODY',text:'Hi {{1}},\n\nYour DropX ID has been created.\n\nDropX ID: {{2}}\nBiometric enrolment ID: {{3}}\n\nUse these details to complete your DropX One registration at https://one.dropxlogistics.com/.\n\nContact your station team if any details need correction.',example:{body_text:[['Sample Associate','DF1147','12345']]}},
    {type:'FOOTER',text:'DropX Logistics'},
    {type:'BUTTONS',buttons:[{type:'URL',text:'Open DropX One',url:'https://one.dropxlogistics.com/'}]}
  ]
} as const;
export const amazonDriverWelcomeMappings = {'body.1':'full_name','body.2':'dropx_id','body.3':'biometric_id'};
