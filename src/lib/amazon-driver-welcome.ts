// Dedicated to the new Amazon flow. Existing onboarding templates stay unchanged.
export const amazonDriverWelcome = {
  name: 'dropx_amazon_driver_welcome_v1',
  language: 'en',
  category: 'UTILITY',
  parameter_format: 'POSITIONAL',
  components: [
    {type:'BODY',text:'Hi {{1}},\n\nYour DropX driver onboarding has started.\n\nDriver ID: {{2}}\nBiometric enrolment ID: {{3}}\n\nYour Amazon email invitation has been requested. When it arrives, open it and complete your Amazon registration. You can view pending steps in DropX One.\n\nOpen https://one.dropxlogistics.com to continue.',example:{body_text:[['Sample Driver','D1234','12345']]}},
    {type:'FOOTER',text:'DropX Logistics'},
    {type:'BUTTONS',buttons:[{type:'URL',text:'Open DropX One',url:'https://one.dropxlogistics.com/'}]}
  ]
} as const;
export const amazonDriverWelcomeMappings = {'body.1':'full_name','body.2':'dropx_id','body.3':'biometric_id'};
